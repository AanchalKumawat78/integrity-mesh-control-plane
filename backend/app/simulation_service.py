import copy
import json
import threading
import time
import uuid
from datetime import datetime
from queue import Empty, Queue

from .database import SessionLocal
from .models import utcnow
from .seed import (
    SIMULATION_STAGE_BLUEPRINTS,
    apply_simulation_tick_preview,
    build_simulation_tick_preview,
)


FINAL_RUN_STATUSES = {"completed", "failed"}


class LiveSimulationManager:
    def __init__(
        self,
        *,
        session_factory=SessionLocal,
        stage_delay_seconds: float = 1.4,
        max_retained_runs: int = 8,
    ) -> None:
        self._session_factory = session_factory
        self._stage_delay_seconds = stage_delay_seconds
        self._max_retained_runs = max_retained_runs
        self._lock = threading.Lock()
        self._runs: dict[str, dict] = {}
        self._run_previews: dict[str, dict] = {}
        self._subscribers: dict[str, list[Queue[str]]] = {}
        self._active_run_id: str | None = None

    def has_running_run(self) -> bool:
        with self._lock:
            return self._active_run_id is not None

    def get_active_run(self) -> dict | None:
        with self._lock:
            if self._active_run_id is None:
                return None
            return copy.deepcopy(self._runs[self._active_run_id])

    def get_run(self, run_id: str) -> dict | None:
        with self._lock:
            run = self._runs.get(run_id)
            return copy.deepcopy(run) if run is not None else None

    def start_run(self) -> dict:
        with self._lock:
            if self._active_run_id is not None:
                return copy.deepcopy(self._runs[self._active_run_id])

        with self._session_factory() as db:
            preview = build_simulation_tick_preview(db)

        run_id = uuid.uuid4().hex[:12]
        state = self._build_initial_run_state(run_id, preview)
        worker = threading.Thread(
            target=self._execute_run,
            args=(run_id,),
            daemon=True,
            name=f"simulation-run-{run_id}",
        )

        with self._lock:
            if self._active_run_id is not None:
                return copy.deepcopy(self._runs[self._active_run_id])
            self._runs[run_id] = state
            self._run_previews[run_id] = preview
            self._subscribers.setdefault(run_id, [])
            self._active_run_id = run_id
            self._trim_retained_runs_locked()

        worker.start()
        return copy.deepcopy(state)

    def stream(self, run_id: str):
        queue = Queue[str]()
        with self._lock:
            if run_id not in self._runs:
                raise KeyError(run_id)
            self._subscribers.setdefault(run_id, []).append(queue)
            initial_snapshot = copy.deepcopy(self._runs[run_id])

        def event_stream():
            try:
                yield self._encode_event("snapshot", initial_snapshot)
                if initial_snapshot["status"] in FINAL_RUN_STATUSES:
                    return

                while True:
                    try:
                        message = queue.get(timeout=10)
                        yield message
                    except Empty:
                        snapshot = self.get_run(run_id)
                        if snapshot is None:
                            return
                        if snapshot["status"] in FINAL_RUN_STATUSES:
                            yield self._encode_event("completed", snapshot)
                            return
                        yield ": keep-alive\n\n"
            finally:
                with self._lock:
                    subscribers = self._subscribers.get(run_id, [])
                    self._subscribers[run_id] = [
                        subscriber for subscriber in subscribers if subscriber is not queue
                    ]

        return event_stream()

    def _build_initial_run_state(self, run_id: str, preview: dict) -> dict:
        started_at = preview["timestamp"]
        zone_progress = []
        map_flows = []

        for zone in preview["zones"]:
            stages = []
            for stage in zone["stages"]:
                stages.append(
                    {
                        **stage,
                        "status": "pending",
                        "started_at": None,
                        "completed_at": None,
                    }
                )

            if zone["flow"] is not None:
                map_flows.append(
                    {
                        **zone["flow"],
                        "started_at": None,
                        "completed_at": None,
                    }
                )

            zone_progress.append(
                {
                    "zone_id": zone["id"],
                    "zone_code": zone["code"],
                    "zone_label": zone["label"],
                    "city": zone["city"],
                    "country": zone["country"],
                    "site_label": zone["site_label"],
                    "region": zone["region"],
                    "latitude": zone["latitude"],
                    "longitude": zone["longitude"],
                    "status": "pending",
                    "active_stage_key": None,
                    "latest_message": "Awaiting live simulation dispatch.",
                    "leader_label": zone["previous_leader_label"] or zone["leader_label"],
                    "batch_label": zone["run"]["batch_label"],
                    "integrity_score": zone["starting_integrity_score"],
                    "secure_transfer_rate": zone["starting_secure_transfer_rate"],
                    "anomalies_found": 0,
                    "transmitted_packets": 0,
                    "leader_changed": zone["leader_changed"],
                    "target_leader_label": zone["leader_label"],
                    "target_integrity_score": zone["integrity_score"],
                    "target_secure_transfer_rate": zone["secure_transfer_rate"],
                    "run_summary": zone["run"],
                    "stages": stages,
                }
            )

        return {
            "id": run_id,
            "status": "pending",
            "started_at": started_at,
            "completed_at": None,
            "total_zones": len(zone_progress),
            "completed_zones": 0,
            "timeline_events": [],
            "map_flows": map_flows,
            "zone_progress": zone_progress,
            "error_message": None,
            "generated_at": started_at,
            "event_counter": 0,
        }

    def _execute_run(self, run_id: str) -> None:
        try:
            with self._lock:
                run = self._runs[run_id]
                run["status"] = "running"
                run["generated_at"] = utcnow()

            self._publish_snapshot(run_id, "progress")

            for blueprint in SIMULATION_STAGE_BLUEPRINTS:
                stage_key = blueprint["key"]
                stage_started_at = utcnow()

                with self._lock:
                    run = self._runs[run_id]
                    for zone in run["zone_progress"]:
                        stage = self._find_stage(zone, stage_key)
                        stage["status"] = "active"
                        stage["started_at"] = stage_started_at
                        zone["status"] = "active"
                        zone["active_stage_key"] = stage_key
                        zone["latest_message"] = stage["detail"]
                        if stage["is_leader"]:
                            zone["leader_label"] = zone["target_leader_label"]

                    if stage_key == "transfer":
                        for flow in run["map_flows"]:
                            flow["status"] = "active"
                            flow["started_at"] = stage_started_at

                    self._append_timeline_events_locked(run, stage_key, "started", stage_started_at)
                    run["generated_at"] = stage_started_at

                self._publish_snapshot(run_id, "progress")
                if self._stage_delay_seconds > 0:
                    time.sleep(self._stage_delay_seconds)

                stage_completed_at = utcnow()
                with self._lock:
                    run = self._runs[run_id]
                    for zone in run["zone_progress"]:
                        stage = self._find_stage(zone, stage_key)
                        stage["status"] = stage["final_status"]
                        stage["completed_at"] = stage_completed_at
                        zone["latest_message"] = stage["detail"]

                        if stage_key == "analysis":
                            zone["anomalies_found"] = zone["run_summary"]["anomalies_found"]
                        elif stage_key == "validation":
                            zone["integrity_score"] = zone["target_integrity_score"]
                        elif stage_key == "transfer":
                            zone["transmitted_packets"] = zone["run_summary"]["transmitted_packets"]
                            zone["secure_transfer_rate"] = zone["target_secure_transfer_rate"]

                    if stage_key == "transfer":
                        for flow in run["map_flows"]:
                            flow["status"] = "completed"
                            flow["completed_at"] = stage_completed_at

                    self._append_timeline_events_locked(run, stage_key, "completed", stage_completed_at)
                    run["generated_at"] = stage_completed_at

                self._publish_snapshot(run_id, "progress")

            preview = self._run_previews[run_id]
            with self._session_factory() as db:
                apply_simulation_tick_preview(db, preview)

            completed_at = utcnow()
            with self._lock:
                run = self._runs[run_id]
                run["status"] = "completed"
                run["completed_at"] = completed_at
                run["completed_zones"] = run["total_zones"]
                run["generated_at"] = completed_at
                for zone in run["zone_progress"]:
                    zone["active_stage_key"] = None
                    zone["leader_label"] = zone["target_leader_label"]
                    zone["status"] = (
                        "warning"
                        if zone["leader_changed"]
                        or any(stage["final_status"] == "warning" for stage in zone["stages"])
                        else "completed"
                    )
                if self._active_run_id == run_id:
                    self._active_run_id = None

            self._publish_snapshot(run_id, "completed")
        except Exception as exc:  # pragma: no cover - best-effort failure path
            failed_at = utcnow()
            with self._lock:
                run = self._runs.get(run_id)
                if run is not None:
                    run["status"] = "failed"
                    run["completed_at"] = failed_at
                    run["generated_at"] = failed_at
                    run["error_message"] = str(exc)
                    if self._active_run_id == run_id:
                        self._active_run_id = None
            self._publish_snapshot(run_id, "failed")

    def _find_stage(self, zone: dict, stage_key: str) -> dict:
        return next(stage for stage in zone["stages"] if stage["key"] == stage_key)

    def _append_timeline_events_locked(
        self,
        run: dict,
        stage_key: str,
        phase: str,
        created_at: datetime,
    ) -> None:
        for zone in run["zone_progress"]:
            stage = self._find_stage(zone, stage_key)
            run["event_counter"] += 1
            run["timeline_events"].insert(
                0,
                {
                    "id": f"{run['id']}-{run['event_counter']:03d}",
                    "zone_id": zone["zone_id"],
                    "zone_label": zone["zone_label"],
                    "stage_key": stage_key,
                    "event_type": f"stage-{phase}",
                    "severity": (
                        "warning"
                        if phase == "completed" and stage["final_status"] == "warning"
                        else "info"
                    ),
                    "message": (
                        f"{zone['zone_label']} entered {stage['label']}."
                        if phase == "started"
                        else stage["detail"]
                    ),
                    "created_at": created_at,
                },
            )
        run["timeline_events"] = run["timeline_events"][:40]

    def _publish_snapshot(self, run_id: str, event_name: str) -> None:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                return
            snapshot = copy.deepcopy(run)
            subscribers = list(self._subscribers.get(run_id, []))

        message = self._encode_event(event_name, snapshot)
        for subscriber in subscribers:
            subscriber.put(message)

    def _trim_retained_runs_locked(self) -> None:
        completed_ids = [
            run_id
            for run_id, run in self._runs.items()
            if run["status"] in FINAL_RUN_STATUSES and run_id != self._active_run_id
        ]
        if len(completed_ids) <= self._max_retained_runs:
            return

        completed_ids.sort(key=lambda run_id: self._runs[run_id]["started_at"])
        for run_id in completed_ids[:-self._max_retained_runs]:
            self._runs.pop(run_id, None)
            self._run_previews.pop(run_id, None)
            self._subscribers.pop(run_id, None)

    def _encode_event(self, event_name: str, payload: dict) -> str:
        return (
            f"event: {event_name}\n"
            f"data: {json.dumps(payload, default=self._json_default)}\n\n"
        )

    def _json_default(self, value):
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)


simulation_manager = LiveSimulationManager()

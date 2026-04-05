from pathlib import Path
import time

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker, selectinload

from app.auth import authenticate_user
from app.database import Base
from app.main import health_check
from app.models import (
    AvailabilityZone,
    GlobalSite,
    MeshSystem,
    SensitiveAccessRequest,
    SensitiveRecord,
    User,
    UserSiteAccess,
    UserSystemAccess,
    UserZoneAccess,
    ZoneDeployment,
)
from app.security_service import (
    approve_access_request,
    create_access_request,
    get_security_posture_payload,
    list_access_requests_payload,
    list_sensitive_records_payload,
    revoke_access_request,
)
from app.seed import get_dashboard_payload, record_audit_log, seed_database, simulate_tick
from app.simulation_service import LiveSimulationManager


def build_session(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False},
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return SessionLocal()


def load_user(db, username: str) -> User:
    return db.scalar(
        select(User)
        .where(User.username == username)
        .options(
            selectinload(User.zone_accesses)
            .selectinload(UserZoneAccess.zone)
            .selectinload(AvailabilityZone.deployment)
            .selectinload(ZoneDeployment.system),
            selectinload(User.zone_accesses)
            .selectinload(UserZoneAccess.zone)
            .selectinload(AvailabilityZone.deployment)
            .selectinload(ZoneDeployment.site),
            selectinload(User.system_accesses).selectinload(UserSystemAccess.system),
            selectinload(User.site_accesses).selectinload(UserSiteAccess.site),
        )
    )


def load_record(db, pseudonym_id: str) -> SensitiveRecord:
    return db.scalar(
        select(SensitiveRecord).where(SensitiveRecord.pseudonym_id == pseudonym_id)
    )


def test_health_check():
    assert health_check() == {"status": "ok"}


def test_seeded_security_assets_and_accounts(tmp_path):
    db = build_session(tmp_path)
    try:
        seed_database(db)
        assert authenticate_user(db, "security", "shield123") is not None
        assert authenticate_user(db, "security", "wrong-password") is None
        assert authenticate_user(db, "monitoring", "monitor123") is not None
        assert db.scalar(select(func.count(User.id))) == 7
        assert db.scalar(select(func.count(MeshSystem.id))) == 3
        assert db.scalar(select(func.count(GlobalSite.id))) == 5
        assert db.scalar(select(func.count(ZoneDeployment.id))) == 5
        assert db.scalar(select(func.count(SensitiveRecord.id))) == 10
        assert db.scalar(select(func.count(SensitiveAccessRequest.id))) == 4
    finally:
        db.close()


def test_dashboard_scope_and_security_context(tmp_path):
    db = build_session(tmp_path)
    try:
        seed_database(db)
        analyst = load_user(db, "policy.analyst")
        payload = get_dashboard_payload(db, analyst)
        posture = get_security_posture_payload(db, analyst)
    finally:
        db.close()

    assert payload["summary"]["total_zones"] == 2
    assert {zone["code"] for zone in payload["zones"]} == {"eu-berlin-1", "ap-mumbai-1"}
    assert payload["viewer"]["assigned_systems"] == ["Identity Resolution Grid"]
    assert {system["code"] for system in payload["systems"]} == {"identity-resolution-grid"}
    assert len(payload["global_locations"]) == 2
    assert payload["workspace"]["home_view"] == "analysis"
    assert payload["security_context"]["active_unmask_grants"] == 1
    assert payload["security_context"]["pending_unmask_requests"] == 1
    assert payload["security_context"]["pending_unmask_reviews"] == 0
    assert payload["approval_policy"]["required_reviewer_role"] == "security_officer"
    assert any(role["role"] == "security_officer" for role in payload["role_directory"])
    assert posture["active_unmask_grants"] >= 1


def test_record_masking_and_approved_access(tmp_path):
    db = build_session(tmp_path)
    try:
        seed_database(db)
        analyst = load_user(db, "policy.analyst")
        records = list_sensitive_records_payload(db, analyst)
    finally:
        db.close()

    by_pseudonym = {record["pseudonym_id"]: record for record in records["records"]}
    assert by_pseudonym["BER-2210"]["is_masked"] is False
    assert by_pseudonym["BER-2210"]["access_status"] == "approved"
    assert by_pseudonym["MUM-5180"]["is_masked"] is True
    assert by_pseudonym["MUM-5180"]["access_status"] == "pending-review"
    assert by_pseudonym["BER-2294"]["is_masked"] is True


def test_access_request_lifecycle_and_visibility(tmp_path):
    db = build_session(tmp_path)
    try:
        seed_database(db)
        operator = load_user(db, "atlantic.operator")
        reviewer = load_user(db, "security.reviewer")
        record = load_record(db, "ATL-7419")

        created = create_access_request(
            db,
            operator,
            record_id=record.id,
            justification="Need raw identity to reconcile an upstream duplicate-benefit flag.",
        )
        requests_for_operator = list_access_requests_payload(db, operator)
        approved = approve_access_request(
            db,
            reviewer,
            request_id=created["id"],
            review_note="Approved for two-hour supervised triage.",
            duration_hours=2,
        )
        records = list_sensitive_records_payload(db, operator)
    finally:
        db.close()

    assert any(request["id"] == created["id"] for request in requests_for_operator["requests"])
    assert approved["status"] == "approved"
    assert approved["requester_role"] == "zone_operator"
    assert approved["reviewer_role"] == "security_officer"
    assert approved["required_reviewer_role"] == "security_officer"
    assert any(
        record_payload["pseudonym_id"] == "ATL-7419" and record_payload["is_masked"] is False
        for record_payload in records["records"]
    )


def test_self_owned_pending_request_is_not_actionable_for_same_reviewer(tmp_path):
    db = build_session(tmp_path)
    try:
        seed_database(db)
        security = load_user(db, "security")
        record = load_record(db, "SAO-3495")
        create_access_request(
            db,
            security,
            record_id=record.id,
            justification="Need direct identity correlation for an internal security analysis handoff.",
        )
        requests_payload = list_access_requests_payload(db, security)
    finally:
        db.close()

    self_owned_request = next(
        request
        for request in requests_payload["requests"]
        if request["record_pseudonym"] == "SAO-3495" and request["status"] == "pending"
    )
    assert self_owned_request["is_actionable"] is False
    assert "Self-approval is blocked by policy" in self_owned_request["review_block_reason"]


def test_reviewer_can_revoke_active_grant(tmp_path):
    db = build_session(tmp_path)
    try:
        seed_database(db)
        analyst = load_user(db, "policy.analyst")
        reviewer = load_user(db, "security.reviewer")
        record = load_record(db, "BER-2210")
        active_request = db.scalar(
            select(SensitiveAccessRequest).where(
                SensitiveAccessRequest.record_id == record.id,
                SensitiveAccessRequest.requester_user_id == analyst.id,
                SensitiveAccessRequest.status == "approved",
            )
        )

        revoked = revoke_access_request(
            db,
            reviewer,
            request_id=active_request.id,
            review_note="Revoked after triage completed and masked view became sufficient.",
        )
        records = list_sensitive_records_payload(db, analyst)
    finally:
        db.close()

    assert revoked["status"] == "revoked"
    assert any(
        record_payload["pseudonym_id"] == "BER-2210"
        and record_payload["is_masked"] is True
        and record_payload["access_status"] == "revoked"
        for record_payload in records["records"]
    )


def test_audit_logging_and_posture_metrics(tmp_path):
    db = build_session(tmp_path)
    try:
        seed_database(db)
        security = load_user(db, "security")
        simulate_tick(db)
        record_audit_log(
            db,
            user=security,
            action="access-request-review",
            resource_type="access-request",
            outcome="denied",
            detail="Denied because operator justification was insufficient",
            ip_address="127.0.0.1",
        )
        posture = get_security_posture_payload(db, security)
    finally:
        db.close()

    assert posture["active_sessions"] >= 0
    assert posture["pending_unmask_reviews"] >= 1
    assert posture["denied_events_24h"] >= 1


def test_live_simulation_manager_streams_and_completes(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'live.db'}",
        connect_args={"check_same_thread": False},
    )
    session_factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
    )
    Base.metadata.create_all(bind=engine)

    with session_factory() as db:
        seed_database(db)

    manager = LiveSimulationManager(
        session_factory=session_factory,
        stage_delay_seconds=0.0,
    )
    run = manager.start_run()

    assert run["status"] in {"pending", "running"}
    assert run["total_zones"] == 5

    for _ in range(100):
        snapshot = manager.get_run(run["id"])
        if snapshot and snapshot["status"] == "completed":
            break
        time.sleep(0.01)
    else:
        raise AssertionError("Live simulation run did not complete")

    assert snapshot["completed_zones"] == snapshot["total_zones"]
    assert any(flow["status"] == "completed" for flow in snapshot["map_flows"])
    assert all(len(zone["stages"]) == 5 for zone in snapshot["zone_progress"])

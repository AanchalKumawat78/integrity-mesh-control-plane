from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.orm import Session

from .ai_controls import AIProviderRequestError, generate_ai_completion, load_ai_provider_status
from .policies import user_can_run_simulation, user_can_view_audit_logs
from .security_service import list_access_requests_payload
from .seed import get_dashboard_payload, list_audit_logs_payload
from .simulation_service import simulation_manager


TOKEN_PATTERN = re.compile(r"[a-z0-9]{3,}")


def generate_ai_advisory_payload(
    db: Session,
    current_user,
    *,
    active_view: str,
    prompt: str,
    conversation: list[dict[str, str]],
) -> dict:
    dashboard = get_dashboard_payload(db, current_user)
    access_requests = list_access_requests_payload(db, current_user)
    audit_logs = (
        list_audit_logs_payload(db, current_user)
        if user_can_view_audit_logs(current_user)
        else {"logs": []}
    )
    simulation_run = (
        simulation_manager.get_active_run()
        if user_can_run_simulation(current_user)
        else None
    )

    documents = _build_context_documents(
        dashboard=dashboard,
        access_requests=access_requests,
        audit_logs=audit_logs,
        simulation_run=simulation_run,
        active_view=active_view,
    )
    citations = _select_citations(documents, prompt, active_view)
    context_block = "\n\n".join(
        f"[{document['id']}] {document['title']}\n{document['content']}"
        for document in citations
    )
    provider_status = load_ai_provider_status()
    purpose = "engineering" if active_view == "engineering" else "research"
    system_prompt = _build_system_prompt(active_view)
    user_prompt = (
        f"Workspace: {active_view}\n"
        f"User role: {current_user.role}\n"
        f"Request: {prompt.strip()}\n\n"
        "Grounded context:\n"
        f"{context_block}\n\n"
        "Return exactly this format:\n"
        "TITLE: <short title>\n"
        "ANSWER:\n"
        "<concise answer grounded in the provided context>\n"
        "FOLLOW_UP:\n"
        "- <follow up 1>\n"
        "- <follow up 2>\n"
        "- <follow up 3>"
    )

    status = "live"
    warning = None
    try:
        completion = generate_ai_completion(
            purpose=purpose,
            system_prompt=system_prompt,
            conversation=conversation,
            user_prompt=user_prompt,
        )
        parsed = _parse_ai_output(completion.text, prompt, active_view)
        provider = completion.provider
        model = completion.model
    except AIProviderRequestError as exc:
        parsed = _build_fallback_output(
            active_view=active_view,
            prompt=prompt,
            citations=citations,
            dashboard=dashboard,
            access_requests=access_requests,
            simulation_run=simulation_run,
        )
        provider = provider_status.provider
        model = provider_status.research_model if purpose == "research" else provider_status.engineering_model
        status = "fallback"
        warning = str(exc)

    return {
        "provider": provider,
        "model": model,
        "status": status,
        "warning": warning,
        "title": parsed["title"],
        "answer": parsed["answer"],
        "suggested_prompts": parsed["suggested_prompts"],
        "citations": [
            {
                "id": document["id"],
                "title": document["title"],
                "detail": document["detail"],
            }
            for document in citations
        ],
        "generated_at": datetime.utcnow(),
    }


def _build_context_documents(
    *,
    dashboard: dict,
    access_requests: dict,
    audit_logs: dict,
    simulation_run: dict | None,
    active_view: str,
) -> list[dict]:
    warning_zones = [
        zone
        for zone in dashboard["zones"]
        if zone["integrity_score"] < 96
        or zone["secure_transfer_rate"] < 96
        or zone["agents"] and any(agent["status"] == "degraded" for agent in zone["agents"])
        or (zone["latest_run"] and zone["latest_run"]["anomalies_found"] > 0)
    ]
    top_zones = warning_zones[:3] or dashboard["zones"][:3]
    pending_requests = [
        request
        for request in access_requests["requests"]
        if request["status"] in {"pending", "approved"}
    ][:3]
    recent_logs = audit_logs.get("logs", [])[:3]
    active_flows = (simulation_run or {}).get("map_flows", [])[:3]

    documents = [
        {
            "id": "workspace-scope",
            "kind": "workspace",
            "title": "Workspace scope",
            "detail": dashboard["workspace"]["persona_summary"],
            "content": (
                f"Persona: {dashboard['workspace']['persona_label']}. "
                f"Home view: {dashboard['workspace']['home_view']}. "
                f"Current view: {active_view}. "
                f"Visible zones: {dashboard['security_context']['visible_zones']}. "
                f"Masked by default: {dashboard['viewer']['masked_by_default']}."
            ),
        },
        {
            "id": "ai-readiness",
            "kind": "ai",
            "title": "AI readiness",
            "detail": dashboard["ai_readiness"]["deployment_status"],
            "content": (
                f"Engineering model: {dashboard['ai_readiness']['engineering_assistant_model']}. "
                f"Research model: {dashboard['ai_readiness']['research_assistant_model']}. "
                f"Embedding strategy: {dashboard['ai_readiness']['embedding_model']}. "
                f"Vector store: {dashboard['ai_readiness']['vector_store']}. "
                f"Next step: {dashboard['ai_readiness']['next_step']}"
            ),
        },
        {
            "id": "security-context",
            "kind": "security",
            "title": "Security context",
            "detail": "Current grants, reviews, and denied events.",
            "content": (
                f"Active raw-access grants: {dashboard['security_posture']['active_unmask_grants']}. "
                f"Pending reviews: {dashboard['security_posture']['pending_unmask_reviews']}. "
                f"Denied events in 24h: {dashboard['security_posture']['denied_events_24h']}. "
                f"Active sessions: {dashboard['security_posture']['active_sessions']}."
            ),
        },
        {
            "id": "global-summary",
            "kind": "summary",
            "title": "Global posture",
            "detail": "Integrity and transfer posture across the visible mesh.",
            "content": (
                f"Zones: {dashboard['summary']['total_zones']}. "
                f"Agents: {dashboard['summary']['total_agents']}. "
                f"Average integrity: {dashboard['summary']['average_integrity']}%. "
                f"Secure transfer rate: {dashboard['summary']['secure_transfer_rate']}%. "
                f"Healthy zones: {dashboard['summary']['healthy_zones']}."
            ),
        },
    ]

    documents.extend(
        {
            "id": f"zone-{zone['id']}",
            "kind": "zone",
            "title": f"{zone['label']} posture",
            "detail": (
                f"{zone['integrity_score']}% integrity, {zone['secure_transfer_rate']}% transfer, "
                f"{zone['latest_run']['anomalies_found'] if zone['latest_run'] else 0} anomalies."
            ),
            "content": (
                f"Zone {zone['label']} in {zone['city']}, {zone['country']}. "
                f"Integrity {zone['integrity_score']}%. "
                f"Transfer {zone['secure_transfer_rate']}%. "
                f"Leader {zone['leader_label']}. "
                f"Recent anomalies {zone['latest_run']['anomalies_found'] if zone['latest_run'] else 0}. "
                f"Degraded agents: {sum(1 for agent in zone['agents'] if agent['status'] == 'degraded')}."
            ),
        }
        for zone in top_zones
    )

    documents.extend(
        {
            "id": f"request-{request['id']}",
            "kind": "request",
            "title": f"{request['zone_label']} access request",
            "detail": f"{request['status']} request for {request['record_pseudonym']}.",
            "content": (
                f"Requester role {request['requester_role']}. "
                f"Status {request['status']}. "
                f"Requested zone {request['zone_label']}. "
                f"Classification {request['classification']}. "
                f"Justification: {request['justification']}."
            ),
        }
        for request in pending_requests
    )

    documents.extend(
        {
            "id": f"log-{log['id']}",
            "kind": "audit",
            "title": f"Audit {log['action']}",
            "detail": log["detail"] or f"{log['action']} on {log['resource_type']}.",
            "content": (
                f"Action {log['action']} on {log['resource_type']}. "
                f"Outcome {log['outcome']}. "
                f"Detail {log['detail'] or 'No extra detail'}. "
                f"Created at {log['created_at']}."
            ),
        }
        for log in recent_logs
    )

    if simulation_run:
        documents.append(
            {
                "id": "simulation-run",
                "kind": "simulation",
                "title": "Live simulation run",
                "detail": (
                    f"{simulation_run['status']} run with {simulation_run['completed_zones']}/"
                    f"{simulation_run['total_zones']} zones completed."
                ),
                "content": (
                    f"Run status {simulation_run['status']}. "
                    f"Completed zones {simulation_run['completed_zones']} of {simulation_run['total_zones']}. "
                    f"Timeline events {len(simulation_run['timeline_events'])}. "
                    f"Active flows {sum(1 for flow in simulation_run['map_flows'] if flow['status'] == 'active')}."
                ),
            }
        )

    documents.extend(
        {
            "id": f"flow-{index + 1}",
            "kind": "flow",
            "title": f"{flow['source_zone_label']} to {flow['target_zone_label']}",
            "detail": f"{flow['status']} flow carrying {flow['packet_count']} packets.",
            "content": (
                f"Source {flow['source_zone_label']} to target {flow['target_zone_label']}. "
                f"Status {flow['status']}. "
                f"Packets {flow['packet_count']}."
            ),
        }
        for index, flow in enumerate(active_flows)
    )

    return documents


def _select_citations(documents: list[dict], prompt: str, active_view: str) -> list[dict]:
    prompt_tokens = _tokenize(f"{active_view} {prompt}")
    ranked = sorted(
        documents,
        key=lambda document: _score_document(document, prompt_tokens, active_view),
        reverse=True,
    )
    return ranked[:4]


def _score_document(document: dict, prompt_tokens: set[str], active_view: str) -> int:
    content_tokens = _tokenize(
        f"{document['title']} {document['detail']} {document['content']}"
    )
    overlap = len(prompt_tokens & content_tokens)
    view_bonus = 0
    if active_view in {"security", "analysis"} and document["kind"] in {"security", "request"}:
        view_bonus += 5
    if active_view in {"threats", "redteam"} and document["kind"] in {"zone", "simulation", "flow"}:
        view_bonus += 5
    if active_view == "solutions" and document["kind"] in {"security", "zone", "audit"}:
        view_bonus += 4
    if active_view == "engineering" and document["kind"] in {"ai", "workspace"}:
        view_bonus += 6
    return overlap * 3 + view_bonus


def _build_system_prompt(active_view: str) -> str:
    return (
        "You are Grok inside the Integrity Mesh Control Plane. "
        "Stay grounded in the provided context only. "
        "Never invent raw subject data, API side effects, approvals, revocations, or mutations. "
        "All recommendations are read-only advisory guidance. "
        f"Tailor the answer to the '{active_view}' workspace. "
        "If the context is incomplete, say what is missing."
    )


def _parse_ai_output(raw_text: str, prompt: str, active_view: str) -> dict:
    title = _derive_title(prompt, active_view)
    answer = raw_text.strip()
    suggested_prompts = _default_follow_ups(active_view)

    if "TITLE:" in raw_text:
        title_segment = raw_text.split("TITLE:", 1)[1].splitlines()[0].strip()
        if title_segment:
            title = title_segment

    if "ANSWER:" in raw_text:
        answer_segment = raw_text.split("ANSWER:", 1)[1]
        if "FOLLOW_UP:" in answer_segment:
            answer_segment = answer_segment.split("FOLLOW_UP:", 1)[0]
        answer = answer_segment.strip()

    if "FOLLOW_UP:" in raw_text:
        follow_up_segment = raw_text.split("FOLLOW_UP:", 1)[1]
        prompts = [
            line.lstrip("- ").strip()
            for line in follow_up_segment.splitlines()
            if line.strip().startswith("-")
        ]
        if prompts:
            suggested_prompts = prompts[:3]

    return {
        "title": title,
        "answer": answer,
        "suggested_prompts": suggested_prompts,
    }


def _build_fallback_output(
    *,
    active_view: str,
    prompt: str,
    citations: list[dict],
    dashboard: dict,
    access_requests: dict,
    simulation_run: dict | None,
) -> dict:
    citation_summary = " ".join(document["detail"] for document in citations[:3])
    answer = (
        f"Grok is currently unavailable, so this response is grounded from the live control-plane data only. "
        f"{citation_summary} "
        f"Pending reviews: {dashboard['security_posture']['pending_unmask_reviews']}. "
        f"Active grants: {dashboard['security_posture']['active_unmask_grants']}. "
        f"Simulation status: {(simulation_run or {}).get('status', 'standby')}."
    ).strip()
    return {
        "title": _derive_title(prompt, active_view),
        "answer": answer,
        "suggested_prompts": _default_follow_ups(active_view),
    }


def _derive_title(prompt: str, active_view: str) -> str:
    trimmed = prompt.strip()
    if trimmed:
        return trimmed[:72]
    return f"{active_view.title()} workspace advisory"


def _default_follow_ups(active_view: str) -> list[str]:
    mapping = {
        "engineering": [
            "What should I wire into pgvector first?",
            "What Grok guardrails should block generated actions?",
            "How should Render and Netlify env vars be configured?",
        ],
        "threats": [
            "Which zone is the easiest attacker foothold right now?",
            "What reviewer or session abuse path is most likely?",
            "Which live signals should trigger containment first?",
        ],
        "redteam": [
            "Which exploit chain has the highest blast radius?",
            "What should the drill simulate next on the map?",
            "How would Grok summarize this scenario for leadership?",
        ],
        "solutions": [
            "What are the top three fixes with the biggest risk reduction?",
            "Which control should be deployed before the next simulation?",
            "How should we phase mitigations by owner?",
        ],
    }
    return mapping.get(
        active_view,
        [
            "What changed most in this workspace?",
            "Which zone needs the fastest attention?",
            "What should I investigate next?",
        ],
    )


def _tokenize(value: str) -> set[str]:
    return {match.group(0) for match in TOKEN_PATTERN.finditer(value.lower())}

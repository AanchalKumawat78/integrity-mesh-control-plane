from __future__ import annotations

from .models import User


ROLE_POLICIES = {
    "admin": {
        "scope": "all",
        "can_view_sensitive": False,
        "can_view_audit_logs": True,
        "can_manage_users": True,
        "can_run_simulation": True,
        "can_request_unmask": False,
        "can_review_unmask": False,
    },
    "security_officer": {
        "scope": "all",
        "can_view_sensitive": True,
        "can_view_audit_logs": True,
        "can_manage_users": False,
        "can_run_simulation": True,
        "can_request_unmask": True,
        "can_review_unmask": True,
    },
    "zone_operator": {
        "scope": "assigned",
        "can_view_sensitive": False,
        "can_view_audit_logs": False,
        "can_manage_users": False,
        "can_run_simulation": False,
        "can_request_unmask": True,
        "can_review_unmask": False,
    },
    "analyst": {
        "scope": "assigned",
        "can_view_sensitive": False,
        "can_view_audit_logs": False,
        "can_manage_users": False,
        "can_run_simulation": False,
        "can_request_unmask": True,
        "can_review_unmask": False,
    },
    "auditor": {
        "scope": "all",
        "can_view_sensitive": False,
        "can_view_audit_logs": True,
        "can_manage_users": False,
        "can_run_simulation": False,
        "can_request_unmask": False,
        "can_review_unmask": False,
    },
    "system": {
        "scope": "all",
        "can_view_sensitive": False,
        "can_view_audit_logs": False,
        "can_manage_users": False,
        "can_run_simulation": False,
        "can_request_unmask": False,
        "can_review_unmask": False,
    },
    "monitor": {
        "scope": "all",
        "can_view_sensitive": False,
        "can_view_audit_logs": True,
        "can_manage_users": False,
        "can_run_simulation": True,
        "can_request_unmask": False,
        "can_review_unmask": False,
    },
}

ROLE_METADATA = {
    "security_officer": {
        "label": "Security Officer",
        "description": "Global security role with request and review authority for temporary raw-data access.",
        "approval_authority": "Can approve, reject, and revoke temporary unmask requests.",
        "login_purpose": "Use for security review, urgent investigations, and temporary raw-access decisions.",
    },
    "admin": {
        "label": "Administrator",
        "description": "Platform operator role for user management, dashboards, and audit visibility.",
        "approval_authority": "Cannot approve raw-data requests.",
        "login_purpose": "Use for account governance, platform operations, and simulation control.",
    },
    "zone_operator": {
        "label": "Zone Operator",
        "description": "Regional operator with assigned-zone scope and masked-by-default subject visibility.",
        "approval_authority": "Can request temporary unmask access but cannot approve it.",
        "login_purpose": "Use for regional monitoring, batch triage, and exception follow-up.",
    },
    "analyst": {
        "label": "Analyst",
        "description": "Assigned-zone analysis role focused on abstracted case views and correlation work.",
        "approval_authority": "Can request temporary unmask access but cannot approve it.",
        "login_purpose": "Use for policy analysis, anomaly review, and pseudonymized intelligence work.",
    },
    "auditor": {
        "label": "Auditor",
        "description": "Read-focused compliance role with audit visibility but no raw-data approval path.",
        "approval_authority": "Cannot request or approve raw-data access.",
        "login_purpose": "Use for compliance checks, evidence review, and access monitoring.",
    },
    "system": {
        "label": "System",
        "description": "Synthetic preview role for system-owned actions and unauthenticated scaffolding.",
        "approval_authority": "No human approval authority.",
        "login_purpose": "Used internally for previews and background processes.",
    },
    "monitor": {
        "label": "Monitoring Specialist",
        "description": "Infrastructure-focused role monitoring Kafka, etcd, and Kubernetes health.",
        "approval_authority": "Cannot request or approve raw-data access.",
        "login_purpose": "Use for infrastructure oversight, Prometheus alerting, and Grafana-style dashboard analysis.",
    },
}

ROLE_ORDER = ["security_officer", "zone_operator", "analyst", "auditor", "admin", "monitor", "system"]

ROLE_WORKSPACE = {
    "admin": {
        "home_view": "operations",
        "views": [
            ("monitoring", "Monitoring", "Global infrastructure health, Prometheus alerts, and Grafana metrics."),
            ("threats", "Threats", "Attacker-view exposure, exploit paths, and live security pressure."),
            ("redteam", "Red Team", "Exploit chains, blast radius, and one-click adversary drills."),
            ("solutions", "Solutions", "Hardening backlog, remediation queue, and zero-trust countermeasures."),
            ("operations", "Operations", "System health, rollout posture, and active control lanes."),
            ("global", "Global", "Worldwide visibility across systems, sites, and zones."),
            ("engineering", "Engineering", "AI rollout planning, deployment readiness, and platform topology."),
            ("compliance", "Compliance", "User scope, approval boundaries, and governance evidence."),
        ],
    },
    "security_officer": {
        "home_view": "security",
        "views": [
            ("security", "Security", "Temporary access approvals, sensitive-record posture, and review queue."),
            ("threats", "Threats", "Adversary paths, exposed approval surfaces, and likely abuse scenarios."),
            ("redteam", "Red Team", "Attack-chain drills, blast-radius scoring, and exploit rehearsal."),
            ("solutions", "Solutions", "Security control fixes, containment playbooks, and mitigation design."),
            ("global", "Global", "Worldwide security posture across systems and sites."),
            ("engineering", "Engineering", "Deployment guardrails, RAG readiness, and agent rollout planning."),
            ("compliance", "Compliance", "Audit activity, role directory, and approval boundaries."),
        ],
    },
    "zone_operator": {
        "home_view": "operations",
        "views": [
            ("operations", "Operations", "Assigned-zone health, site location, and run status."),
            ("global", "Global", "Global context for the systems touching your assigned sites."),
        ],
    },
    "analyst": {
        "home_view": "analysis",
        "views": [
            ("analysis", "Analysis", "Abstracted records, request workflow, and system-by-system context."),
            ("global", "Global", "Cross-region system context for approved analytical scope."),
            ("engineering", "Engineering", "RAG rollout plan for engineering copilots and analyst retrieval."),
        ],
    },
    "auditor": {
        "home_view": "compliance",
        "views": [
            ("compliance", "Compliance", "Audit evidence, role boundaries, and access visibility."),
            ("threats", "Threats", "Control failures, abuse indicators, and red-team style exposure analysis."),
            ("redteam", "Red Team", "Exploit rehearsal against approvals, sessions, and transfer controls."),
            ("solutions", "Solutions", "Evidence-backed remediation priorities and control reinforcement plan."),
            ("global", "Global", "Worldwide scope, locations, and control-plane posture."),
        ],
    },
    "system": {
        "home_view": "global",
        "views": [
            ("global", "Global", "System preview across the full prototype footprint."),
        ],
    },
    "monitor": {
        "home_view": "monitoring",
        "views": [
            ("monitoring", "Monitoring", "Global infrastructure health, Prometheus alerts, and Grafana metrics."),
            ("threats", "Threats", "Infrastructure-centric adversary paths, blast radius, and weak points."),
            ("redteam", "Red Team", "Exploit drills for runtime, transfer lanes, and high-value sessions."),
            ("solutions", "Solutions", "Operational mitigations, isolation controls, and response playbooks."),
            ("operations", "Operations", "Regional site status and active control lanes."),
            ("global", "Global", "Worldwide visibility across systems, sites, and zones."),
        ],
    },
}


def get_role_policy(role: str) -> dict:
    return ROLE_POLICIES.get(role, ROLE_POLICIES["analyst"])


def get_role_metadata(role: str) -> dict:
    return ROLE_METADATA.get(role, ROLE_METADATA["analyst"])


def get_role_workspace(role: str) -> dict:
    return ROLE_WORKSPACE.get(role, ROLE_WORKSPACE["analyst"])


def user_can_view_sensitive(user: User | None) -> bool:
    if user is None:
        return False
    return bool(get_role_policy(user.role)["can_view_sensitive"])


def user_can_view_audit_logs(user: User | None) -> bool:
    if user is None:
        return False
    return bool(get_role_policy(user.role)["can_view_audit_logs"])


def user_can_manage_users(user: User | None) -> bool:
    if user is None:
        return False
    return bool(get_role_policy(user.role)["can_manage_users"])


def user_can_run_simulation(user: User | None) -> bool:
    if user is None:
        return False
    return bool(get_role_policy(user.role)["can_run_simulation"])


def user_can_request_unmask(user: User | None) -> bool:
    if user is None:
        return False
    return bool(get_role_policy(user.role)["can_request_unmask"])


def user_can_review_unmask(user: User | None) -> bool:
    if user is None:
        return False
    return bool(get_role_policy(user.role)["can_review_unmask"])


def user_has_global_scope(user: User | None) -> bool:
    if user is None:
        return True
    return get_role_policy(user.role)["scope"] == "all"


def get_user_zone_ids(user: User | None) -> set[int]:
    if user is None:
        return set()
    return {access.zone_id for access in user.zone_accesses}


def get_user_system_zone_ids(user: User | None) -> set[int]:
    if user is None:
        return set()
    zone_ids = set()
    for access in getattr(user, "system_accesses", []):
        system = getattr(access, "system", None)
        if system is None:
            continue
        zone_ids.update(deployment.zone_id for deployment in getattr(system, "deployments", []))
    return zone_ids


def get_user_site_zone_ids(user: User | None) -> set[int]:
    if user is None:
        return set()
    zone_ids = set()
    for access in getattr(user, "site_accesses", []):
        site = getattr(access, "site", None)
        if site is None:
            continue
        zone_ids.update(deployment.zone_id for deployment in getattr(site, "deployments", []))
    return zone_ids


def _unique_labels(values: list[str]) -> list[str]:
    seen = set()
    labels = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        labels.append(value)
    return labels


def _derive_assigned_systems(user: User | None) -> list[str]:
    if user is None:
        return ["all systems"]

    labels = [
        access.system.label
        for access in getattr(user, "system_accesses", [])
        if getattr(access, "system", None) is not None
    ]
    labels.extend(
        access.zone.deployment.system.label
        for access in getattr(user, "zone_accesses", [])
        if getattr(access, "zone", None) is not None
        and getattr(access.zone, "deployment", None) is not None
        and getattr(access.zone.deployment, "system", None) is not None
    )
    labels = _unique_labels(labels)
    if user_has_global_scope(user):
        return labels or ["all systems"]
    return labels


def _derive_assigned_sites(user: User | None) -> list[str]:
    if user is None:
        return ["all sites"]

    labels = [
        access.site.label
        for access in getattr(user, "site_accesses", [])
        if getattr(access, "site", None) is not None
    ]
    labels.extend(
        access.zone.deployment.site.label
        for access in getattr(user, "zone_accesses", [])
        if getattr(access, "zone", None) is not None
        and getattr(access.zone, "deployment", None) is not None
        and getattr(access.zone.deployment, "site", None) is not None
    )
    labels = _unique_labels(labels)
    if user_has_global_scope(user):
        return labels or ["all sites"]
    return labels


def user_can_access_zone(user: User | None, zone_id: int) -> bool:
    if user is None or user_has_global_scope(user):
        return True
    accessible_zone_ids = (
        get_user_zone_ids(user)
        | get_user_system_zone_ids(user)
        | get_user_site_zone_ids(user)
    )
    return zone_id in accessible_zone_ids


def serialize_workspace(user: User | None) -> dict:
    role = user.role if user else "system"
    metadata = get_role_metadata(role)
    workspace = get_role_workspace(role)
    return {
        "home_view": workspace["home_view"],
        "persona_label": metadata["label"],
        "persona_summary": metadata["login_purpose"],
        "available_views": [
            {
                "key": key,
                "label": label,
                "description": description,
            }
            for key, label, description in workspace["views"]
        ],
    }


def serialize_user_profile(user: User | None) -> dict:
    if user is None:
        policy = get_role_policy("system")
        metadata = get_role_metadata("system")
        workspace = get_role_workspace("system")
        return {
            "id": 0,
            "username": "system-preview",
            "full_name": "System Preview",
            "role": "system",
            "clearance_level": "masked",
            "assigned_zones": ["all zones"],
            "assigned_systems": ["all systems"],
            "assigned_sites": ["all sites"],
            "can_view_sensitive": policy["can_view_sensitive"],
            "can_view_audit_logs": policy["can_view_audit_logs"],
            "can_manage_users": policy["can_manage_users"],
            "can_run_simulation": policy["can_run_simulation"],
            "can_request_unmask": policy["can_request_unmask"],
            "can_review_unmask": policy["can_review_unmask"],
            "masked_by_default": True,
            "approval_authority": metadata["approval_authority"],
            "workspace_home": workspace["home_view"],
        }

    policy = get_role_policy(user.role)
    metadata = get_role_metadata(user.role)
    workspace = get_role_workspace(user.role)
    assigned_zones = [access.zone.label for access in user.zone_accesses]
    if policy["scope"] == "all":
        assigned_zones = assigned_zones or ["all zones"]

    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "clearance_level": user.clearance_level,
        "assigned_zones": assigned_zones,
        "assigned_systems": _derive_assigned_systems(user),
        "assigned_sites": _derive_assigned_sites(user),
        "can_view_sensitive": policy["can_view_sensitive"],
        "can_view_audit_logs": policy["can_view_audit_logs"],
        "can_manage_users": policy["can_manage_users"],
        "can_run_simulation": policy["can_run_simulation"],
        "can_request_unmask": policy["can_request_unmask"],
        "can_review_unmask": policy["can_review_unmask"],
        "masked_by_default": True,
        "approval_authority": metadata["approval_authority"],
        "workspace_home": workspace["home_view"],
    }


def build_security_context(
    user: User | None,
    visible_zone_count: int,
    *,
    active_unmask_grants: int = 0,
    pending_unmask_requests: int = 0,
    pending_unmask_reviews: int = 0,
) -> dict:
    profile = serialize_user_profile(user)
    return {
        "masked_view": active_unmask_grants == 0,
        "visible_zones": visible_zone_count,
        "can_view_sensitive": profile["can_view_sensitive"],
        "can_view_audit_logs": profile["can_view_audit_logs"],
        "can_manage_users": profile["can_manage_users"],
        "can_run_simulation": profile["can_run_simulation"],
        "can_request_unmask": profile["can_request_unmask"],
        "can_review_unmask": profile["can_review_unmask"],
        "active_unmask_grants": active_unmask_grants,
        "pending_unmask_requests": pending_unmask_requests,
        "pending_unmask_reviews": pending_unmask_reviews,
    }


def serialize_role_directory() -> list[dict]:
    directory = []
    for role in ROLE_ORDER:
        policy = get_role_policy(role)
        metadata = get_role_metadata(role)
        directory.append(
            {
                "role": role,
                "label": metadata["label"],
                "description": metadata["description"],
                "scope": policy["scope"],
                "can_view_sensitive": policy["can_view_sensitive"],
                "can_view_audit_logs": policy["can_view_audit_logs"],
                "can_manage_users": policy["can_manage_users"],
                "can_run_simulation": policy["can_run_simulation"],
                "can_request_unmask": policy["can_request_unmask"],
                "can_review_unmask": policy["can_review_unmask"],
                "approval_authority": metadata["approval_authority"],
                "login_purpose": metadata["login_purpose"],
            }
        )
    return directory


def serialize_approval_policy() -> dict:
    requester_roles = [
        role
        for role in ROLE_ORDER
        if get_role_policy(role)["can_request_unmask"]
    ]
    reviewer_roles = [
        role
        for role in ROLE_ORDER
        if get_role_policy(role)["can_review_unmask"]
    ]
    return {
        "requester_roles": requester_roles,
        "reviewer_roles": reviewer_roles,
        "required_reviewer_role": "security_officer",
        "self_approval_blocked": True,
        "raw_access_mode": "temporary-grant",
        "approval_model": "single-stage reviewer approval",
    }


def mask_name(value: str) -> str:
    return " ".join(_mask_chunk(chunk, keep_start=1, keep_end=0) for chunk in value.split())


def mask_identifier(value: str) -> str:
    return _mask_chunk(value, keep_start=2, keep_end=2)


def mask_phone(value: str) -> str:
    digits = "".join(char for char in value if char.isdigit())
    if len(digits) < 4:
        return "***"
    return f"***-***-{digits[-4:]}"


def mask_address(value: str) -> str:
    if not value:
        return "Restricted address"
    segments = value.split(",", 1)
    if len(segments) == 1:
        return "Restricted address"
    return f"Restricted address, {segments[1].strip()}"


def mask_case_reference(value: str) -> str:
    return _mask_chunk(value, keep_start=4, keep_end=2)


def _mask_chunk(value: str, keep_start: int, keep_end: int) -> str:
    if not value:
        return value
    if len(value) <= keep_start + keep_end:
        return "*" * len(value)
    middle = "*" * (len(value) - keep_start - keep_end)
    return f"{value[:keep_start]}{middle}{value[-keep_end:] if keep_end else ''}"

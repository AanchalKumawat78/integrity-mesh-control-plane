import random
from collections.abc import Iterable
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .ai_controls import load_ai_provider_status
from .auth import hash_password
from .models import (
    ActivityEvent,
    Agent,
    AuditLog,
    AvailabilityZone,
    GlobalSite,
    MeshSystem,
    PipelineRun,
    SensitiveAccessRequest,
    SensitiveRecord,
    User,
    UserSiteAccess,
    UserSystemAccess,
    UserZoneAccess,
    ZoneDeployment,
    utcnow,
)
from .policies import (
    mask_address,
    mask_case_reference,
    mask_identifier,
    mask_name,
    mask_phone,
    serialize_approval_policy,
    serialize_role_directory,
    serialize_user_profile,
    serialize_workspace,
    user_can_access_zone,
    user_can_manage_users,
    user_can_view_audit_logs,
    user_can_view_sensitive,
    user_has_global_scope,
)
from .security_service import build_enriched_security_context, get_security_posture_payload


SYSTEM_BLUEPRINTS = [
    {
        "code": "citizen-services-core",
        "label": "Citizen Services Core",
        "category": "benefits-integrity",
        "deployment_model": "active-active regional mesh",
        "stewardship_model": "federal shared operations",
    },
    {
        "code": "identity-resolution-grid",
        "label": "Identity Resolution Grid",
        "category": "cross-agency identity verification",
        "deployment_model": "policy-linked regional pods",
        "stewardship_model": "multi-region analyst collaboration",
    },
    {
        "code": "mobility-assurance-network",
        "label": "Mobility Assurance Network",
        "category": "grant and travel assurance",
        "deployment_model": "sealed transfer edge mesh",
        "stewardship_model": "global compliance oversight",
    },
]

SIMULATION_STAGE_BLUEPRINTS = [
    {
        "key": "collection",
        "label": "Collect",
        "role": "data-collection",
        "note": "source intake",
    },
    {
        "key": "preprocessing",
        "label": "Prep",
        "role": "data-preprocessing",
        "note": "normalize + mask",
    },
    {
        "key": "analysis",
        "label": "Analyze",
        "role": "data-analysis",
        "note": "score + trace",
    },
    {
        "key": "validation",
        "label": "Validate",
        "role": "test-postprocess",
        "note": "validate + seal",
    },
    {
        "key": "transfer",
        "label": "Transfer",
        "role": "data-transfer",
        "note": "leader dispatch",
    },
]

SIMULATION_AGGREGATOR_ZONE_CODE = "eu-berlin-1"

SITE_BLUEPRINTS = [
    {
        "code": "va-command-campus",
        "label": "Virginia Command Campus",
        "city": "Virginia",
        "country": "United States",
        "region": "North America",
        "timezone": "America/New_York",
        "latitude": 37.4316,
        "longitude": -78.6569,
        "residency_tier": "sovereign",
    },
    {
        "code": "berlin-oversight-campus",
        "label": "Berlin Oversight Campus",
        "city": "Berlin",
        "country": "Germany",
        "region": "Europe",
        "timezone": "Europe/Berlin",
        "latitude": 52.52,
        "longitude": 13.405,
        "residency_tier": "regulated",
    },
    {
        "code": "mumbai-integrity-campus",
        "label": "Mumbai Integrity Campus",
        "city": "Mumbai",
        "country": "India",
        "region": "Asia Pacific",
        "timezone": "Asia/Kolkata",
        "latitude": 19.076,
        "longitude": 72.8777,
        "residency_tier": "sovereign",
    },
    {
        "code": "sao-data-campus",
        "label": "Sao Paulo Data Campus",
        "city": "Sao Paulo",
        "country": "Brazil",
        "region": "South America",
        "timezone": "America/Sao_Paulo",
        "latitude": -23.5505,
        "longitude": -46.6333,
        "residency_tier": "restricted",
    },
    {
        "code": "sydney-transfer-campus",
        "label": "Sydney Transfer Campus",
        "city": "Sydney",
        "country": "Australia",
        "region": "Oceania",
        "timezone": "Australia/Sydney",
        "latitude": -33.8688,
        "longitude": 151.2093,
        "residency_tier": "regulated",
    },
]


ZONE_BLUEPRINTS = [
    {
        "code": "us-atlantic-1",
        "label": "Atlantic Command Hub",
        "city": "Virginia",
        "country": "United States",
        "sensitivity_tier": "sovereign",
        "system_code": "citizen-services-core",
        "site_code": "va-command-campus",
        "provider": "aws-gov",
        "network_posture": "private backbone",
        "messaging_stack": "Kafka",
        "leader_election_stack": "etcd",
        "compute_stack": "Kubernetes",
        "security_stack": "Vault + mTLS",
        "storage_stack": "S3 + encryption",
        "monitoring_stack": "Prometheus + Grafana",
    },
    {
        "code": "eu-berlin-1",
        "label": "Continental Oversight Cell",
        "city": "Berlin",
        "country": "Germany",
        "sensitivity_tier": "regulated",
        "system_code": "identity-resolution-grid",
        "site_code": "berlin-oversight-campus",
        "provider": "eu-sovereign-cloud",
        "network_posture": "policy-isolated fabric",
        "messaging_stack": "Kafka",
        "leader_election_stack": "Consul",
        "compute_stack": "Kubernetes",
        "security_stack": "Vault + mTLS",
        "storage_stack": "S3 + encryption",
        "monitoring_stack": "Prometheus + Grafana",
    },
    {
        "code": "ap-mumbai-1",
        "label": "South Asia Integrity Mesh",
        "city": "Mumbai",
        "country": "India",
        "sensitivity_tier": "sovereign",
        "system_code": "identity-resolution-grid",
        "site_code": "mumbai-integrity-campus",
        "provider": "india-public-cloud",
        "network_posture": "residency-locked enclave",
        "messaging_stack": "Kafka",
        "leader_election_stack": "etcd",
        "compute_stack": "Kubernetes",
        "security_stack": "Vault + mTLS",
        "storage_stack": "S3 + encryption",
        "monitoring_stack": "Prometheus + Grafana",
    },
    {
        "code": "sa-sao-1",
        "label": "Southern Data Shield",
        "city": "Sao Paulo",
        "country": "Brazil",
        "sensitivity_tier": "restricted",
        "system_code": "citizen-services-core",
        "site_code": "sao-data-campus",
        "provider": "latam-secure-host",
        "network_posture": "federated private mesh",
        "messaging_stack": "Kafka",
        "leader_election_stack": "Consul",
        "compute_stack": "Kubernetes",
        "security_stack": "Vault + mTLS",
        "storage_stack": "S3 + encryption",
        "monitoring_stack": "Prometheus + Grafana",
    },
    {
        "code": "oc-sydney-1",
        "label": "Pacific Transfer Vault",
        "city": "Sydney",
        "country": "Australia",
        "sensitivity_tier": "regulated",
        "system_code": "mobility-assurance-network",
        "site_code": "sydney-transfer-campus",
        "provider": "apac-edge-cloud",
        "network_posture": "sealed transfer edge",
        "messaging_stack": "Kafka",
        "leader_election_stack": "etcd",
        "compute_stack": "Kubernetes",
        "security_stack": "Vault + mTLS",
        "storage_stack": "S3 + encryption",
        "monitoring_stack": "Prometheus + Grafana",
    },
]

AGENT_BLUEPRINTS = [
    {
        "role": "data-collection",
        "label": "Collection Agent",
        "code_suffix": "collector",
        "security_clearance": "segmented",
        "abstraction_level": "tier-2",
    },
    {
        "role": "data-preprocessing",
        "label": "Preprocess Agent",
        "code_suffix": "preprocess",
        "security_clearance": "segmented",
        "abstraction_level": "tier-3",
    },
    {
        "role": "data-analysis",
        "label": "Analysis Agent",
        "code_suffix": "analysis",
        "security_clearance": "sealed",
        "abstraction_level": "tier-4",
    },
    {
        "role": "test-postprocess",
        "label": "Validation Agent",
        "code_suffix": "validation",
        "security_clearance": "sealed",
        "abstraction_level": "tier-4",
    },
    {
        "role": "data-transfer",
        "label": "Transfer Leader Agent",
        "code_suffix": "transfer",
        "security_clearance": "sovereign",
        "abstraction_level": "tier-5",
    },
]

USER_BLUEPRINTS = [
    {
        "username": "admin",
        "full_name": "Platform Administrator",
        "role": "admin",
        "clearance_level": "sovereign",
        "password": "admin123",
        "zones": "all",
        "systems": "all",
        "sites": "all",
    },
    {
        "username": "security",
        "full_name": "Security Officer",
        "role": "security_officer",
        "clearance_level": "sovereign",
        "password": "shield123",
        "zones": "all",
        "systems": "all",
        "sites": "all",
    },
    {
        "username": "security.reviewer",
        "full_name": "Security Reviewer",
        "role": "security_officer",
        "clearance_level": "sovereign",
        "password": "review123",
        "zones": "all",
        "systems": "all",
        "sites": "all",
    },
    {
        "username": "atlantic.operator",
        "full_name": "Atlantic Zone Operator",
        "role": "zone_operator",
        "clearance_level": "sealed",
        "password": "zone123",
        "zones": ["us-atlantic-1"],
        "systems": [],
        "sites": ["va-command-campus"],
    },
    {
        "username": "policy.analyst",
        "full_name": "Regional Policy Analyst",
        "role": "analyst",
        "clearance_level": "sealed",
        "password": "analyst123",
        "zones": [],
        "systems": ["identity-resolution-grid"],
        "sites": [],
    },
    {
        "username": "auditor",
        "full_name": "Compliance Auditor",
        "role": "auditor",
        "clearance_level": "regulated",
        "password": "audit123",
        "zones": "all",
        "systems": "all",
        "sites": "all",
    },
    {
        "username": "monitoring",
        "full_name": "Monitoring Specialist",
        "role": "monitor",
        "clearance_level": "restricted",
        "password": "monitor123",
        "zones": "all",
        "systems": "all",
        "sites": "all",
    },
]

ACCESS_REQUEST_BLUEPRINTS = [
    {
        "record_pseudonym": "ATL-7419",
        "requester": "security",
        "reviewer": "security.reviewer",
        "status": "approved",
        "justification": "Incident response drill requires raw validation of a protected welfare case.",
        "review_note": "Approved for supervised drill validation.",
        "duration_hours": 8,
    },
    {
        "record_pseudonym": "BER-2210",
        "requester": "policy.analyst",
        "reviewer": "security.reviewer",
        "status": "approved",
        "justification": "Need subject-level comparison to validate duplicate document clustering.",
        "review_note": "Approved for duplicate-identity investigation.",
        "duration_hours": 6,
    },
    {
        "record_pseudonym": "MUM-5180",
        "requester": "policy.analyst",
        "reviewer": None,
        "status": "pending",
        "justification": "Need raw citizen identifier to complete anomaly trace and close the review batch.",
        "review_note": None,
        "duration_hours": None,
    },
    {
        "record_pseudonym": "ATL-9130",
        "requester": "atlantic.operator",
        "reviewer": "security.reviewer",
        "status": "rejected",
        "justification": "Need direct identity for faster local triage.",
        "review_note": "Rejected because abstracted summary is sufficient for current operator workflow.",
        "duration_hours": None,
    },
]

SENSITIVE_RECORD_BLUEPRINTS = [
    {
        "zone_code": "us-atlantic-1",
        "pseudonym_id": "ATL-7419",
        "subject_name": "Elena Brooks",
        "government_identifier": "US-VA-4471-88",
        "phone_number": "+1-202-555-0142",
        "address": "1254 River Street, Arlington, Virginia",
        "case_reference": "CASE-ATL-2041",
        "source_agency": "Public Welfare Coordination Office",
        "classification": "secret",
        "handling_status": "abstracted",
        "abstracted_summary": "Benefits-disbursement investigation cross-checked against duplicate household identifiers.",
    },
    {
        "zone_code": "us-atlantic-1",
        "pseudonym_id": "ATL-9130",
        "subject_name": "Marcus Hale",
        "government_identifier": "US-VA-8820-14",
        "phone_number": "+1-703-555-0177",
        "address": "88 Franklin Avenue, Norfolk, Virginia",
        "case_reference": "CASE-ATL-2047",
        "source_agency": "Veteran Support Clearinghouse",
        "classification": "restricted",
        "handling_status": "validation",
        "abstracted_summary": "Eligibility trail held for validation after mismatched service-history metadata.",
    },
    {
        "zone_code": "eu-berlin-1",
        "pseudonym_id": "BER-2210",
        "subject_name": "Nina Weber",
        "government_identifier": "DE-BE-9982-11",
        "phone_number": "+49-30-555-0133",
        "address": "14 Linden Platz, Berlin, Germany",
        "case_reference": "CASE-BER-8711",
        "source_agency": "Civic Identity Registry",
        "classification": "confidential",
        "handling_status": "abstracted",
        "abstracted_summary": "Identity reconciliation case flagged for cross-ministry duplicate document review.",
    },
    {
        "zone_code": "eu-berlin-1",
        "pseudonym_id": "BER-2294",
        "subject_name": "Tobias Klein",
        "government_identifier": "DE-BE-1160-42",
        "phone_number": "+49-30-555-0184",
        "address": "79 Schiller Strasse, Berlin, Germany",
        "case_reference": "CASE-BER-8732",
        "source_agency": "Border Services Integrity Desk",
        "classification": "secret",
        "handling_status": "analysis",
        "abstracted_summary": "Travel-clearance anomaly moved to analyst review with subject identity removed from downstream packet.",
    },
    {
        "zone_code": "ap-mumbai-1",
        "pseudonym_id": "MUM-5180",
        "subject_name": "Aarav Sharma",
        "government_identifier": "IN-MH-6621-53",
        "phone_number": "+91-98765-30142",
        "address": "22 Carter Road, Mumbai, Maharashtra",
        "case_reference": "CASE-MUM-1104",
        "source_agency": "Citizen Services Directorate",
        "classification": "secret",
        "handling_status": "abstracted",
        "abstracted_summary": "Duplicate subsidy routing indicators isolated for manual fraud scoring.",
    },
    {
        "zone_code": "ap-mumbai-1",
        "pseudonym_id": "MUM-5255",
        "subject_name": "Priya Nair",
        "government_identifier": "IN-MH-7740-27",
        "phone_number": "+91-98111-20478",
        "address": "43 Marine Drive, Mumbai, Maharashtra",
        "case_reference": "CASE-MUM-1112",
        "source_agency": "Urban Housing Review Board",
        "classification": "restricted",
        "handling_status": "validation",
        "abstracted_summary": "Residency attestation packet under post-process testing after address confidence dropped below threshold.",
    },
    {
        "zone_code": "sa-sao-1",
        "pseudonym_id": "SAO-3408",
        "subject_name": "Camila Rocha",
        "government_identifier": "BR-SP-5104-63",
        "phone_number": "+55-11-5555-1401",
        "address": "11 Rua Augusta, Sao Paulo, Brazil",
        "case_reference": "CASE-SAO-5403",
        "source_agency": "Public Health Verification Unit",
        "classification": "confidential",
        "handling_status": "analysis",
        "abstracted_summary": "Vaccination-aid entitlement packet held for anomaly scoring with clinic identity removed.",
    },
    {
        "zone_code": "sa-sao-1",
        "pseudonym_id": "SAO-3495",
        "subject_name": "Joao Mendes",
        "government_identifier": "BR-SP-4021-89",
        "phone_number": "+55-11-5555-1779",
        "address": "77 Avenida Paulista, Sao Paulo, Brazil",
        "case_reference": "CASE-SAO-5411",
        "source_agency": "Transit Subsidy Board",
        "classification": "restricted",
        "handling_status": "abstracted",
        "abstracted_summary": "Transit-fare relief review synchronized after cardholder identity was tokenized.",
    },
    {
        "zone_code": "oc-sydney-1",
        "pseudonym_id": "SYD-7716",
        "subject_name": "Olivia Hart",
        "government_identifier": "AU-NSW-2180-34",
        "phone_number": "+61-2-5550-1942",
        "address": "9 Harbour Lane, Sydney, New South Wales",
        "case_reference": "CASE-SYD-9804",
        "source_agency": "National Grants Oversight Office",
        "classification": "secret",
        "handling_status": "transfer-ready",
        "abstracted_summary": "Grant-beneficiary review passed validation after source identifiers were sealed from transfer stage.",
    },
    {
        "zone_code": "oc-sydney-1",
        "pseudonym_id": "SYD-7791",
        "subject_name": "Liam Cooper",
        "government_identifier": "AU-NSW-6632-77",
        "phone_number": "+61-2-5550-2108",
        "address": "42 George Street, Sydney, New South Wales",
        "case_reference": "CASE-SYD-9819",
        "source_agency": "Regional Services Portal",
        "classification": "confidential",
        "handling_status": "analysis",
        "abstracted_summary": "Service-request linkage isolated due to location mismatch during pre-transfer validation.",
    },
]

CLEARANCE_RANK = {"segmented": 1, "sealed": 2, "sovereign": 3}


def seed_database(db: Session) -> None:
    system_count = db.scalar(select(func.count(MeshSystem.id))) or 0
    if system_count == 0:
        _seed_systems(db)

    site_count = db.scalar(select(func.count(GlobalSite.id))) or 0
    if site_count == 0:
        _seed_sites(db)

    zone_count = db.scalar(select(func.count(AvailabilityZone.id))) or 0
    if zone_count == 0:
        _seed_zones(db)

    system_map = {
        system.code: system
        for system in db.scalars(select(MeshSystem).order_by(MeshSystem.id))
    }
    site_map = {
        site.code: site
        for site in db.scalars(select(GlobalSite).order_by(GlobalSite.id))
    }
    zone_map = {
        zone.code: zone
        for zone in db.scalars(select(AvailabilityZone).order_by(AvailabilityZone.id))
    }

    _seed_zone_deployments(db, zone_map, system_map, site_map)
    _seed_users(db, zone_map, system_map, site_map)
    _seed_sensitive_records(db, zone_map)

    user_map = {
        user.username: user
        for user in db.scalars(select(User).order_by(User.id))
    }
    record_map = {
        record.pseudonym_id: record
        for record in db.scalars(select(SensitiveRecord).order_by(SensitiveRecord.id))
    }
    _seed_access_requests(db, user_map, record_map)

    db.commit()


def simulate_tick(db: Session) -> None:
    preview = build_simulation_tick_preview(db)
    apply_simulation_tick_preview(db, preview)


def build_simulation_tick_preview(db: Session) -> dict:
    timestamp = utcnow()
    zones = _load_zones(db)
    aggregator_zone = _get_simulation_aggregator_zone(zones)

    preview_zones = []
    for tick_index, zone in enumerate(zones, start=1):
        rng = random.Random(f"{zone.code}-{timestamp.isoformat()}")

        for agent in zone.agents:
            agent.heartbeat_at = timestamp
            degraded = agent.role == "data-transfer" and rng.random() < 0.12
            agent.status = "degraded" if degraded else "active"
            agent.encryption_state = "rotating" if degraded else "sealed"
            agent.checksum_state = "revalidating" if rng.random() < 0.06 else "verified"

        previous_leader_id = zone.leader_agent_id
        leader = _elect_leader(zone.agents)
        for agent in zone.agents:
            agent.is_leader = agent.id == leader.id

        latest_run = _build_pipeline_run(zone, leader, tick=tick_index + len(zone.pipeline_runs))
        latest_run.started_at = timestamp
        latest_run.completed_at = timestamp

        integrity_score = latest_run.integrity_score
        secure_transfer_rate = round(
            min(100.0, latest_run.integrity_score + rng.uniform(0.2, 0.8)),
            2,
        )
        abstraction_mode = "sealed" if latest_run.anomalies_found == 0 else "reviewed"
        transfer_target = (
            aggregator_zone
            if aggregator_zone is not None and aggregator_zone.id != zone.id
            else None
        )
        stage_previews = _build_simulation_stage_previews(
            zone,
            leader,
            latest_run,
            transfer_target,
        )
        flow_preview = _build_simulation_flow_preview(
            zone,
            latest_run,
            transfer_target,
        )
        event_previews = _build_simulation_event_previews(
            zone,
            leader,
            latest_run,
            previous_leader_id=previous_leader_id,
            transfer_target=transfer_target,
            timestamp=timestamp,
        )
        deployment = zone.deployment
        site = deployment.site if deployment else None

        preview_zones.append(
            {
                "id": zone.id,
                "code": zone.code,
                "label": zone.label,
                "city": zone.city,
                "country": zone.country,
                "site_code": site.code if site else None,
                "site_label": site.label if site else None,
                "region": site.region if site else None,
                "latitude": site.latitude if site else None,
                "longitude": site.longitude if site else None,
                "starting_integrity_score": round(zone.integrity_score, 2),
                "starting_secure_transfer_rate": round(zone.secure_transfer_rate, 2),
                "leader_agent_id": leader.id,
                "leader_label": leader.label,
                "previous_leader_id": previous_leader_id,
                "previous_leader_label": zone.leader_agent.label if zone.leader_agent else None,
                "leader_changed": bool(previous_leader_id and previous_leader_id != leader.id),
                "integrity_score": integrity_score,
                "secure_transfer_rate": secure_transfer_rate,
                "abstraction_mode": abstraction_mode,
                "run": _serialize_run(latest_run),
                "agents": [
                    {
                        "id": agent.id,
                        "code": agent.code,
                        "label": agent.label,
                        "role": agent.role,
                        "is_leader": agent.is_leader,
                        "status": agent.status,
                        "security_clearance": agent.security_clearance,
                        "encryption_state": agent.encryption_state,
                        "checksum_state": agent.checksum_state,
                        "abstraction_level": agent.abstraction_level,
                        "heartbeat_at": agent.heartbeat_at,
                    }
                    for agent in zone.agents
                ],
                "stages": stage_previews,
                "flow": flow_preview,
                "events": event_previews,
            }
        )

    return {
        "timestamp": timestamp,
        "aggregator_zone_id": aggregator_zone.id if aggregator_zone else None,
        "zones": preview_zones,
    }


def apply_simulation_tick_preview(db: Session, preview: dict) -> None:
    timestamp = preview["timestamp"]
    zone_map = {zone.id: zone for zone in _load_zones(db)}

    for zone_preview in preview["zones"]:
        zone = zone_map[zone_preview["id"]]
        agent_map = {agent.id: agent for agent in zone.agents}

        for agent_preview in zone_preview["agents"]:
            agent = agent_map[agent_preview["id"]]
            agent.is_leader = agent_preview["is_leader"]
            agent.status = agent_preview["status"]
            agent.encryption_state = agent_preview["encryption_state"]
            agent.checksum_state = agent_preview["checksum_state"]
            agent.heartbeat_at = agent_preview["heartbeat_at"]

        zone.leader_agent_id = zone_preview["leader_agent_id"]
        zone.last_election_at = timestamp
        zone.integrity_score = zone_preview["integrity_score"]
        zone.secure_transfer_rate = zone_preview["secure_transfer_rate"]
        zone.abstraction_mode = zone_preview["abstraction_mode"]

        run_preview = zone_preview["run"]
        db.add(
            PipelineRun(
                zone_id=zone.id,
                leader_agent_id=run_preview["leader_agent_id"],
                batch_label=run_preview["batch_label"],
                status=run_preview["status"],
                collected_records=run_preview["collected_records"],
                redacted_records=run_preview["redacted_records"],
                transmitted_packets=run_preview["transmitted_packets"],
                anomalies_found=run_preview["anomalies_found"],
                integrity_score=run_preview["integrity_score"],
                started_at=run_preview["started_at"],
                completed_at=run_preview["completed_at"],
            )
        )

        for event_preview in zone_preview["events"]:
            db.add(
                ActivityEvent(
                    zone_id=zone.id,
                    agent_id=event_preview["agent_id"],
                    event_type=event_preview["event_type"],
                    severity=event_preview["severity"],
                    message=event_preview["message"],
                    abstraction_applied=event_preview["abstraction_applied"],
                    integrity_score=event_preview["integrity_score"],
                    created_at=event_preview["created_at"],
                )
            )

    db.commit()


def get_dashboard_payload(db: Session, viewer: User | None = None) -> dict:
    zones = _filter_visible_zones(_load_zones(db), viewer)
    zone_payloads = [_serialize_zone(zone) for zone in zones]
    latest_runs = [zone.pipeline_runs[0] for zone in zones if zone.pipeline_runs]
    leaders = [zone.leader_agent for zone in zones if zone.leader_agent]
    security_posture = get_security_posture_payload(db, viewer)
    visible_systems = _build_visible_systems(zones)
    visible_locations = _build_visible_locations(zones)
    visible_regions = {
        zone.deployment.site.region
        for zone in zones
        if zone.deployment and zone.deployment.site
    }

    global_events = []
    for zone in zones:
        global_events.extend(zone.events[:3])
    global_events.sort(key=lambda event: event.created_at, reverse=True)

    healthy_zones = sum(
        1
        for zone in zones
        if zone.integrity_score >= 97 and zone.leader_agent and zone.leader_agent.status == "active"
    )

    return {
        "generated_at": utcnow(),
        "viewer": serialize_user_profile(viewer),
        "workspace": serialize_workspace(viewer),
        "ai_readiness": _build_ai_readiness_payload(viewer),
        "global_control_plane": {
            "status": "active",
            "leader": "Global Control Cell (VA-01)",
            "policy_engine": "Sealed-Policy-v4",
            "last_heartbeat": utcnow(),
        },
        "security_context": build_enriched_security_context(db, viewer, len(zones)),
        "security_posture": security_posture,
        "role_directory": serialize_role_directory(),
        "approval_policy": serialize_approval_policy(),
        "summary": {
            "total_zones": len(zones),
            "total_agents": sum(len(zone.agents) for zone in zones),
            "active_leaders": sum(1 for leader in leaders if leader.status == "active"),
            "healthy_zones": healthy_zones,
            "redacted_records": sum(run.redacted_records for run in latest_runs),
            "transmitted_packets": sum(run.transmitted_packets for run in latest_runs),
            "average_integrity": round(
                sum(zone.integrity_score for zone in zones) / max(len(zones), 1),
                2,
            ),
            "secure_transfer_rate": round(
                sum(zone.secure_transfer_rate for zone in zones) / max(len(zones), 1),
                2,
            ),
        },
        "topology": {
            "systems": len(visible_systems),
            "sites": len(visible_locations),
            "regions": len(visible_regions),
            "zones": len(zones),
            "agents_per_zone": len(AGENT_BLUEPRINTS),
            "leader_role": "data-transfer",
            "protection_model": "segmented collection -> abstraction -> sealed transfer",
            "access_model": "role + system + site + zone scoped visibility",
        },
        "systems": visible_systems,
        "global_locations": visible_locations,
        "zones": zone_payloads,
        "global_events": [_serialize_event(event) for event in global_events[:12]],
    }


def get_zone_payload(db: Session, zone_id: int, viewer: User | None = None) -> dict | None:
    zone = db.scalar(
        select(AvailabilityZone)
        .where(AvailabilityZone.id == zone_id)
        .options(
            selectinload(AvailabilityZone.agents),
            selectinload(AvailabilityZone.events),
            selectinload(AvailabilityZone.pipeline_runs).selectinload(PipelineRun.leader_agent),
            selectinload(AvailabilityZone.leader_agent),
            selectinload(AvailabilityZone.deployment).selectinload(ZoneDeployment.system),
            selectinload(AvailabilityZone.deployment).selectinload(ZoneDeployment.site),
        )
    )
    if zone is None:
        return None
    if not user_can_access_zone(viewer, zone.id):
        return None
    return _serialize_zone(zone)


def list_sensitive_records_payload(
    db: Session,
    viewer: User,
    zone_id: int | None = None,
) -> dict:
    if zone_id is not None and not user_can_access_zone(viewer, zone_id):
        raise PermissionError("Not allowed to view this zone")

    records = list(
        db.scalars(
            select(SensitiveRecord)
            .options(selectinload(SensitiveRecord.zone))
            .order_by(SensitiveRecord.created_at.desc())
        )
    )
    allowed_zone_ids = _get_allowed_zone_ids(records, viewer)

    visible_records = [
        record
        for record in records
        if record.zone_id in allowed_zone_ids and (zone_id is None or record.zone_id == zone_id)
    ]

    return {
        "masked_view": not user_can_view_sensitive(viewer),
        "visible_count": len(visible_records),
        "records": [_serialize_sensitive_record(record, viewer) for record in visible_records],
    }


def list_users_payload(db: Session, viewer: User) -> dict:
    if not user_can_manage_users(viewer):
        raise PermissionError("Only administrators can view the user roster")

    users = list(
        db.scalars(
            select(User)
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
            .order_by(User.id)
        )
    )

    return {
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "full_name": user.full_name,
                "role": user.role,
                "clearance_level": user.clearance_level,
                "is_active": user.is_active,
                "last_login_at": user.last_login_at,
                "assigned_zones": serialize_user_profile(user)["assigned_zones"],
                "assigned_systems": serialize_user_profile(user)["assigned_systems"],
                "assigned_sites": serialize_user_profile(user)["assigned_sites"],
            }
            for user in users
        ]
    }


def list_audit_logs_payload(db: Session, viewer: User) -> dict:
    if not user_can_view_audit_logs(viewer):
        raise PermissionError("Only auditors and security roles can view audit logs")

    logs = list(
        db.scalars(
            select(AuditLog)
            .options(selectinload(AuditLog.user))
            .order_by(AuditLog.created_at.desc())
        )
    )

    return {
        "logs": [
            {
                "id": log.id,
                "username": log.user.username if log.user else None,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "outcome": log.outcome,
                "detail": log.detail,
                "ip_address": log.ip_address,
                "created_at": log.created_at,
            }
            for log in logs[:50]
        ]
    }


def record_audit_log(
    db: Session,
    *,
    action: str,
    resource_type: str,
    user: User | None = None,
    resource_id: str | None = None,
    outcome: str = "success",
    detail: str | None = None,
    ip_address: str | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            detail=detail,
            ip_address=ip_address,
        )
    )
    db.commit()


def _seed_systems(db: Session) -> None:
    for blueprint in SYSTEM_BLUEPRINTS:
        if db.scalar(select(MeshSystem).where(MeshSystem.code == blueprint["code"])) is not None:
            continue
        db.add(
            MeshSystem(
                code=blueprint["code"],
                label=blueprint["label"],
                category=blueprint["category"],
                deployment_model=blueprint["deployment_model"],
                stewardship_model=blueprint["stewardship_model"],
            )
        )
    db.commit()


def _seed_sites(db: Session) -> None:
    for blueprint in SITE_BLUEPRINTS:
        if db.scalar(select(GlobalSite).where(GlobalSite.code == blueprint["code"])) is not None:
            continue
        db.add(
            GlobalSite(
                code=blueprint["code"],
                label=blueprint["label"],
                city=blueprint["city"],
                country=blueprint["country"],
                region=blueprint["region"],
                timezone=blueprint["timezone"],
                latitude=blueprint["latitude"],
                longitude=blueprint["longitude"],
                residency_tier=blueprint["residency_tier"],
            )
        )
    db.commit()


def _seed_zones(db: Session) -> None:
    for zone_index, blueprint in enumerate(ZONE_BLUEPRINTS, start=1):
        zone = AvailabilityZone(
            code=blueprint["code"],
            label=blueprint["label"],
            city=blueprint["city"],
            country=blueprint["country"],
            sensitivity_tier=blueprint["sensitivity_tier"],
            abstraction_mode="sealed",
            integrity_score=98.7 - (zone_index * 0.2),
            secure_transfer_rate=99.4 - (zone_index * 0.1),
        )
        db.add(zone)
        db.flush()

        agents: list[Agent] = []
        for agent_index, agent_blueprint in enumerate(AGENT_BLUEPRINTS, start=1):
            agent = Agent(
                zone_id=zone.id,
                code=f"{zone.code}-{agent_blueprint['code_suffix']}",
                label=agent_blueprint["label"],
                role=agent_blueprint["role"],
                is_leader=agent_index == 5,
                status="active",
                security_clearance=agent_blueprint["security_clearance"],
                encryption_state="sealed",
                checksum_state="verified",
                abstraction_level=agent_blueprint["abstraction_level"],
            )
            db.add(agent)
            agents.append(agent)

        db.flush()
        leader = next(agent for agent in agents if agent.is_leader)
        zone.leader_agent_id = leader.id

        initial_run = _build_pipeline_run(zone, leader, tick=zone_index)
        db.add(initial_run)
        db.flush()

        for event in _build_seed_events(zone, agents, leader, initial_run):
            db.add(event)

    db.commit()


def _seed_zone_deployments(
    db: Session,
    zone_map: dict[str, AvailabilityZone],
    system_map: dict[str, MeshSystem],
    site_map: dict[str, GlobalSite],
) -> None:
    for blueprint in ZONE_BLUEPRINTS:
        zone = zone_map[blueprint["code"]]
        existing = db.scalar(
            select(ZoneDeployment).where(ZoneDeployment.zone_id == zone.id)
        )
        if existing is not None:
            continue
        db.add(
            ZoneDeployment(
                zone_id=zone.id,
                system_id=system_map[blueprint["system_code"]].id,
                site_id=site_map[blueprint["site_code"]].id,
                provider=blueprint["provider"],
                network_posture=blueprint["network_posture"],
                messaging_stack=blueprint["messaging_stack"],
                leader_election_stack=blueprint["leader_election_stack"],
                compute_stack=blueprint["compute_stack"],
                security_stack=blueprint["security_stack"],
                storage_stack=blueprint["storage_stack"],
                monitoring_stack=blueprint["monitoring_stack"],
                status="active",
            )
        )
    db.commit()


def _seed_users(
    db: Session,
    zone_map: dict[str, AvailabilityZone],
    system_map: dict[str, MeshSystem],
    site_map: dict[str, GlobalSite],
) -> None:
    for blueprint in USER_BLUEPRINTS:
        user = db.scalar(select(User).where(User.username == blueprint["username"]))
        if user is None:
            user = User(
                username=blueprint["username"],
                full_name=blueprint["full_name"],
                role=blueprint["role"],
                clearance_level=blueprint["clearance_level"],
                password_hash=hash_password(blueprint["password"]),
                is_active=True,
            )
            db.add(user)
            db.flush()

        if blueprint["zones"] != "all":
            for zone_code in blueprint["zones"]:
                zone = zone_map[zone_code]
                existing_access = db.scalar(
                    select(UserZoneAccess).where(
                        UserZoneAccess.user_id == user.id,
                        UserZoneAccess.zone_id == zone.id,
                    )
                )
                if existing_access is None:
                    db.add(UserZoneAccess(user_id=user.id, zone_id=zone.id))

        if blueprint["systems"] != "all":
            for system_code in blueprint["systems"]:
                system = system_map[system_code]
                existing_access = db.scalar(
                    select(UserSystemAccess).where(
                        UserSystemAccess.user_id == user.id,
                        UserSystemAccess.system_id == system.id,
                    )
                )
                if existing_access is None:
                    db.add(UserSystemAccess(user_id=user.id, system_id=system.id))

        if blueprint["sites"] != "all":
            for site_code in blueprint["sites"]:
                site = site_map[site_code]
                existing_access = db.scalar(
                    select(UserSiteAccess).where(
                        UserSiteAccess.user_id == user.id,
                        UserSiteAccess.site_id == site.id,
                    )
                )
                if existing_access is None:
                    db.add(UserSiteAccess(user_id=user.id, site_id=site.id))

    db.commit()


def _seed_sensitive_records(db: Session, zone_map: dict[str, AvailabilityZone]) -> None:
    for blueprint in SENSITIVE_RECORD_BLUEPRINTS:
        existing_record = db.scalar(
            select(SensitiveRecord).where(
                SensitiveRecord.pseudonym_id == blueprint["pseudonym_id"]
            )
        )
        if existing_record is not None:
            continue
        zone = zone_map[blueprint["zone_code"]]
        db.add(
            SensitiveRecord(
                zone_id=zone.id,
                pseudonym_id=blueprint["pseudonym_id"],
                subject_name=blueprint["subject_name"],
                government_identifier=blueprint["government_identifier"],
                phone_number=blueprint["phone_number"],
                address=blueprint["address"],
                case_reference=blueprint["case_reference"],
                source_agency=blueprint["source_agency"],
                classification=blueprint["classification"],
                handling_status=blueprint["handling_status"],
                redaction_state="masked",
                abstracted_summary=blueprint["abstracted_summary"],
            )
        )

    db.commit()


def _seed_access_requests(
    db: Session,
    user_map: dict[str, User],
    record_map: dict[str, SensitiveRecord],
) -> None:
    now = utcnow()

    for blueprint in ACCESS_REQUEST_BLUEPRINTS:
        requester = user_map[blueprint["requester"]]
        reviewer = user_map[blueprint["reviewer"]] if blueprint["reviewer"] else None
        record = record_map[blueprint["record_pseudonym"]]
        existing_request = db.scalar(
            select(SensitiveAccessRequest).where(
                SensitiveAccessRequest.record_id == record.id,
                SensitiveAccessRequest.requester_user_id == requester.id,
                SensitiveAccessRequest.status == blueprint["status"],
                SensitiveAccessRequest.justification == blueprint["justification"],
            )
        )
        if existing_request is not None:
            continue

        reviewed_at = None
        expires_at = None
        if blueprint["status"] in {"approved", "rejected"}:
            reviewed_at = now
        if blueprint["status"] == "approved" and blueprint["duration_hours"] is not None:
            expires_at = now + timedelta(hours=blueprint["duration_hours"])

        db.add(
            SensitiveAccessRequest(
                record_id=record.id,
                requester_user_id=requester.id,
                reviewer_user_id=reviewer.id if reviewer else None,
                status=blueprint["status"],
                justification=blueprint["justification"],
                review_note=blueprint["review_note"],
                requested_at=now,
                reviewed_at=reviewed_at,
                expires_at=expires_at,
            )
        )

    db.commit()


def _load_zones(db: Session) -> list[AvailabilityZone]:
    return list(
        db.scalars(
            select(AvailabilityZone)
            .options(
                selectinload(AvailabilityZone.agents),
                selectinload(AvailabilityZone.events).selectinload(ActivityEvent.agent),
                selectinload(AvailabilityZone.pipeline_runs).selectinload(PipelineRun.leader_agent),
                selectinload(AvailabilityZone.leader_agent),
                selectinload(AvailabilityZone.deployment).selectinload(ZoneDeployment.system),
                selectinload(AvailabilityZone.deployment).selectinload(ZoneDeployment.site),
            )
            .order_by(AvailabilityZone.id)
        )
    )


def _filter_visible_zones(zones: list[AvailabilityZone], viewer: User | None) -> list[AvailabilityZone]:
    return [zone for zone in zones if user_can_access_zone(viewer, zone.id)]


def _get_allowed_zone_ids(records: list[SensitiveRecord], viewer: User) -> set[int]:
    if user_has_global_scope(viewer):
        return {record.zone_id for record in records}
    return {access.zone_id for access in viewer.zone_accesses}


def _get_simulation_aggregator_zone(
    zones: list[AvailabilityZone],
) -> AvailabilityZone | None:
    explicit_zone = next(
        (zone for zone in zones if zone.code == SIMULATION_AGGREGATOR_ZONE_CODE),
        None,
    )
    if explicit_zone is not None:
        return explicit_zone

    return next(
        (
            zone
            for zone in zones
            if zone.deployment and zone.deployment.site and zone.deployment.site.region == "Europe"
        ),
        None,
    )


def _build_simulation_stage_previews(
    zone: AvailabilityZone,
    leader: Agent,
    run: PipelineRun,
    transfer_target: AvailabilityZone | None,
) -> list[dict]:
    agent_map = {agent.role: agent for agent in zone.agents}

    return [
        _build_stage_preview(
            blueprint,
            agent_map[blueprint["role"]],
            leader,
            zone,
            run,
            transfer_target,
        )
        for blueprint in SIMULATION_STAGE_BLUEPRINTS
    ]


def _build_stage_preview(
    blueprint: dict,
    agent: Agent,
    leader: Agent,
    zone: AvailabilityZone,
    run: PipelineRun,
    transfer_target: AvailabilityZone | None,
) -> dict:
    detail, metric_display, final_status = _get_stage_runtime_copy(
        blueprint["key"],
        zone,
        run,
        transfer_target,
    )

    return {
        "key": blueprint["key"],
        "label": blueprint["label"],
        "role": blueprint["role"],
        "note": blueprint["note"],
        "detail": detail,
        "metric_display": metric_display,
        "final_status": final_status,
        "agent_id": agent.id,
        "agent_label": agent.label,
        "agent_status": agent.status,
        "security_clearance": agent.security_clearance,
        "encryption_state": agent.encryption_state,
        "checksum_state": agent.checksum_state,
        "abstraction_level": agent.abstraction_level,
        "is_leader": agent.id == leader.id,
    }


def _get_stage_runtime_copy(
    stage_key: str,
    zone: AvailabilityZone,
    run: PipelineRun,
    transfer_target: AvailabilityZone | None,
) -> tuple[str, str | None, str]:
    if stage_key == "collection":
        return (
            f"Ingesting {run.collected_records:,} protected records from {zone.label}.",
            f"{run.collected_records:,} records",
            "completed",
        )
    if stage_key == "preprocessing":
        return (
            f"Abstracting {run.redacted_records:,} sensitive fields before downstream scoring.",
            f"{run.redacted_records:,} sealed",
            "completed",
        )
    if stage_key == "analysis":
        severity = "warning" if run.anomalies_found > 0 else "completed"
        return (
            (
                f"Flagging {run.anomalies_found} anomaly candidates for policy review."
                if run.anomalies_found > 0
                else "Policy scoring complete with no anomaly escalation."
            ),
            f"{run.anomalies_found} anomalies",
            severity,
        )
    if stage_key == "validation":
        severity = "warning" if run.anomalies_found > 0 else "completed"
        return (
            f"Checksum validation sealed the batch at {run.integrity_score}% integrity.",
            f"{run.integrity_score}% integrity",
            severity,
        )
    if transfer_target is not None:
        return (
            f"Dispatching {run.transmitted_packets:,} sealed packets to {transfer_target.label}.",
            f"{run.transmitted_packets:,} packets",
            "completed",
        )
    return (
        f"Aggregating inbound sealed packets at {zone.label} and confirming residency controls.",
        f"{run.transmitted_packets:,} packets",
        "completed",
    )


def _build_simulation_flow_preview(
    zone: AvailabilityZone,
    run: PipelineRun,
    transfer_target: AvailabilityZone | None,
) -> dict | None:
    if transfer_target is None or zone.deployment is None or zone.deployment.site is None:
        return None

    target_site = transfer_target.deployment.site if transfer_target.deployment else None
    if target_site is None:
        return None

    source_site = zone.deployment.site
    return {
        "id": f"{zone.code}->{transfer_target.code}",
        "kind": "sealed-transfer",
        "status": "pending",
        "source_zone_id": zone.id,
        "source_zone_label": zone.label,
        "source_site_code": source_site.code,
        "source_site_label": source_site.label,
        "source_latitude": source_site.latitude,
        "source_longitude": source_site.longitude,
        "target_zone_id": transfer_target.id,
        "target_zone_label": transfer_target.label,
        "target_site_code": target_site.code,
        "target_site_label": target_site.label,
        "target_latitude": target_site.latitude,
        "target_longitude": target_site.longitude,
        "packet_count": run.transmitted_packets,
    }


def _build_simulation_event_previews(
    zone: AvailabilityZone,
    leader: Agent,
    run: PipelineRun,
    *,
    previous_leader_id: int | None,
    transfer_target: AvailabilityZone | None,
    timestamp,
) -> list[dict]:
    events = [
        {
            "agent_id": zone.agents[0].id,
            "event_type": "collection",
            "severity": "info",
            "message": (
                f"Kafka {zone.deployment.messaging_stack} source intake active in {zone.label}; "
                "ingesting raw streams from local government backbone."
            ),
            "abstraction_applied": False,
            "integrity_score": zone.integrity_score,
            "created_at": timestamp,
        },
        {
            "agent_id": leader.id,
            "event_type": "pipeline-sync",
            "severity": "info" if run.anomalies_found == 0 else "warning",
            "message": (
                f"{leader.label} coordinated {run.batch_label} with "
                f"{run.redacted_records} records abstracted before transfer."
            ),
            "abstraction_applied": True,
            "integrity_score": run.integrity_score,
            "created_at": timestamp,
        },
    ]

    if previous_leader_id and previous_leader_id != leader.id:
        events.append(
            {
                "agent_id": leader.id,
                "event_type": "leader-election",
                "severity": "warning",
                "message": (
                    f"Leader failover activated via {zone.deployment.leader_election_stack} in {zone.label}; "
                    f"{leader.label} ({zone.deployment.compute_stack}) assumed coordination responsibility."
                ),
                "abstraction_applied": True,
                "integrity_score": run.integrity_score,
                "created_at": timestamp,
            }
        )

    if transfer_target is not None:
        message = (
            f"Transfer Svc in {zone.label} pushing {run.transmitted_packets} "
            f"sealed packets to {transfer_target.label}."
        )
    else:
        message = (
            f"Secure aggregation lane in {zone.label} receiving sealed packets "
            "from global regional transfer services."
        )

    events.append(
        {
            "agent_id": leader.id,
            "event_type": "transfer",
            "severity": "info",
            "message": message,
            "abstraction_applied": True,
            "integrity_score": run.integrity_score,
            "created_at": timestamp,
        }
    )
    return events


def _build_pipeline_run(zone: AvailabilityZone, leader: Agent, tick: int) -> PipelineRun:
    rng = random.Random(f"{zone.code}-{tick}-{leader.role}")
    collected_records = rng.randint(1400, 2600)
    redacted_records = int(collected_records * rng.uniform(0.28, 0.5))
    transmitted_packets = collected_records - redacted_records
    anomalies_found = rng.randint(0, 2 if leader.role == "data-transfer" else 4)
    integrity_score = round(
        max(94.0, 99.7 - (anomalies_found * rng.uniform(0.7, 1.4))),
        2,
    )

    return PipelineRun(
        zone_id=zone.id,
        leader_agent_id=leader.id,
        batch_label=f"batch-{tick:03d}",
        status="sealed" if anomalies_found == 0 else "reviewed",
        collected_records=collected_records,
        redacted_records=redacted_records,
        transmitted_packets=transmitted_packets,
        anomalies_found=anomalies_found,
        integrity_score=integrity_score,
    )


def _build_seed_events(
    zone: AvailabilityZone,
    agents: list[Agent],
    leader: Agent,
    initial_run: PipelineRun,
) -> Iterable[ActivityEvent]:
    return [
        ActivityEvent(
            zone_id=zone.id,
            agent_id=agents[0].id,
            event_type="collection",
            severity="info",
            message=(
                f"{agents[0].label} ingested protected records into {zone.label} "
                "with source identities segmented from downstream analysis."
            ),
            abstraction_applied=True,
            integrity_score=initial_run.integrity_score,
        ),
        ActivityEvent(
            zone_id=zone.id,
            agent_id=agents[2].id,
            event_type="analysis",
            severity="info",
            message=(
                f"{agents[2].label} completed policy scoring and anomaly triage "
                "without exposing raw identifiers."
            ),
            abstraction_applied=True,
            integrity_score=initial_run.integrity_score,
        ),
        ActivityEvent(
            zone_id=zone.id,
            agent_id=leader.id,
            event_type="transfer",
            severity="info",
            message=(
                f"{leader.label} sealed {initial_run.transmitted_packets} packets "
                f"after abstracting {initial_run.redacted_records} sensitive records."
            ),
            abstraction_applied=True,
            integrity_score=initial_run.integrity_score,
        ),
    ]


def _elect_leader(agents: list[Agent]) -> Agent:
    healthy_agents = [
        agent
        for agent in agents
        if agent.status == "active" and agent.encryption_state == "sealed"
    ]
    if not healthy_agents:
        return max(agents, key=lambda agent: CLEARANCE_RANK[agent.security_clearance])

    preferred = next(
        (agent for agent in healthy_agents if agent.role == "data-transfer"),
        None,
    )
    if preferred is not None:
        return preferred

    return max(
        healthy_agents,
        key=lambda agent: (CLEARANCE_RANK[agent.security_clearance], agent.abstraction_level),
    )


def _serialize_zone(zone: AvailabilityZone) -> dict:
    latest_run = zone.pipeline_runs[0] if zone.pipeline_runs else None
    leader = zone.leader_agent
    deployment = zone.deployment
    system = deployment.system if deployment else None
    site = deployment.site if deployment else None

    return {
        "id": zone.id,
        "code": zone.code,
        "label": zone.label,
        "city": zone.city,
        "country": zone.country,
        "system_code": system.code if system else None,
        "system_label": system.label if system else None,
        "site_code": site.code if site else None,
        "site_label": site.label if site else None,
        "region": site.region if site else None,
        "timezone": site.timezone if site else None,
        "latitude": site.latitude if site else None,
        "longitude": site.longitude if site else None,
        "provider": deployment.provider if deployment else None,
        "network_posture": deployment.network_posture if deployment else None,
        "messaging_stack": deployment.messaging_stack if deployment else None,
        "leader_election_stack": deployment.leader_election_stack if deployment else None,
        "compute_stack": deployment.compute_stack if deployment else None,
        "security_stack": deployment.security_stack if deployment else None,
        "storage_stack": deployment.storage_stack if deployment else None,
        "monitoring_stack": deployment.monitoring_stack if deployment else None,
        "sensitivity_tier": zone.sensitivity_tier,
        "abstraction_mode": zone.abstraction_mode,
        "integrity_score": round(zone.integrity_score, 2),
        "secure_transfer_rate": round(zone.secure_transfer_rate, 2),
        "last_election_at": zone.last_election_at,
        "leader_agent_id": zone.leader_agent_id,
        "leader_label": leader.label if leader else None,
        "agents": [
            {
                "id": agent.id,
                "code": agent.code,
                "label": agent.label,
                "role": agent.role,
                "is_leader": agent.is_leader,
                "status": agent.status,
                "security_clearance": agent.security_clearance,
                "encryption_state": agent.encryption_state,
                "checksum_state": agent.checksum_state,
                "abstraction_level": agent.abstraction_level,
                "heartbeat_at": agent.heartbeat_at,
            }
            for agent in zone.agents
        ],
        "latest_run": _serialize_run(latest_run) if latest_run else None,
        "recent_events": [_serialize_event(event) for event in zone.events[:5]],
    }


def _build_visible_systems(zones: list[AvailabilityZone]) -> list[dict]:
    system_map: dict[int, dict] = {}
    for zone in zones:
        deployment = zone.deployment
        if deployment is None or deployment.system is None:
            continue
        bucket = system_map.setdefault(
            deployment.system.id,
            {
                "system": deployment.system,
                "zones": [],
                "site_ids": set(),
            },
        )
        bucket["zones"].append(zone)
        bucket["site_ids"].add(deployment.site_id)

    serialized = []
    for entry in system_map.values():
        system = entry["system"]
        system_zones = entry["zones"]
        serialized.append(
            {
                "id": system.id,
                "code": system.code,
                "label": system.label,
                "category": system.category,
                "deployment_model": system.deployment_model,
                "stewardship_model": system.stewardship_model,
                "visible_zones": len(system_zones),
                "visible_sites": len(entry["site_ids"]),
                "healthy_zones": sum(
                    1
                    for zone in system_zones
                    if zone.integrity_score >= 97
                    and zone.leader_agent
                    and zone.leader_agent.status == "active"
                ),
                "average_integrity": round(
                    sum(zone.integrity_score for zone in system_zones) / max(len(system_zones), 1),
                    2,
                ),
            }
        )
    return sorted(serialized, key=lambda item: item["label"])


def _build_visible_locations(zones: list[AvailabilityZone]) -> list[dict]:
    site_map: dict[int, dict] = {}
    for zone in zones:
        deployment = zone.deployment
        if deployment is None or deployment.site is None:
            continue
        bucket = site_map.setdefault(
            deployment.site.id,
            {
                "site": deployment.site,
                "zones": [],
                "system_ids": set(),
            },
        )
        bucket["zones"].append(zone)
        bucket["system_ids"].add(deployment.system_id)

    serialized = []
    for entry in site_map.values():
        site = entry["site"]
        site_zones = entry["zones"]
        warning_events = sum(
            1
            for zone in site_zones
            for event in zone.events[:3]
            if event.severity != "info"
        )
        serialized.append(
            {
                "id": site.id,
                "code": site.code,
                "label": site.label,
                "city": site.city,
                "country": site.country,
                "region": site.region,
                "timezone": site.timezone,
                "latitude": round(site.latitude, 4),
                "longitude": round(site.longitude, 4),
                "residency_tier": site.residency_tier,
                "visible_zones": len(site_zones),
                "active_systems": len(entry["system_ids"]),
                "warning_events": warning_events,
                "average_integrity": round(
                    sum(zone.integrity_score for zone in site_zones) / max(len(site_zones), 1),
                    2,
                ),
            }
        )
    return sorted(serialized, key=lambda item: (item["region"], item["label"]))


def _build_ai_readiness_payload(viewer: User | None) -> dict:
    role = viewer.role if viewer else "system"
    provider_status = load_ai_provider_status()
    recommended_scope = {
        "admin": "Engineer-facing deployment copilot with approval-gated actions",
        "security_officer": "Security review copilot with cited RAG and deployment guardrails",
        "zone_operator": "Read-only site operations assistant with system and location filters",
        "analyst": "Retrieval-first analyst workspace with citations and request-aware masking",
        "auditor": "Compliance evidence assistant with immutable audit context",
        "system": "Preview mode for the AI operations rollout",
    }.get(role, "Retrieval-first engineering assistant")
    next_step = {
        "admin": "Connect deployment runbooks, infra docs, and site inventories into the vector layer.",
        "security_officer": "Attach approval policy docs and incident runbooks before enabling reviewer tooling.",
        "zone_operator": "Index local site runbooks and asset manifests with site metadata filters.",
        "analyst": "Index investigation playbooks and abstracted case history before enabling generated briefs.",
        "auditor": "Ingest control evidence, policy history, and access-review artifacts for cited retrieval.",
        "system": "Complete Postgres + pgvector migration and role-scoped retrieval wiring.",
    }.get(role, "Complete the role-scoped retrieval and deployment toolchain.")
    return {
        "engineering_assistant_model": (
            f"{provider_status.provider}/{provider_status.engineering_model}"
        ),
        "research_assistant_model": (
            f"{provider_status.provider}/{provider_status.research_model}"
        ),
        "embedding_model": f"{provider_status.provider}/{provider_status.embedding_model}",
        "vector_store": "PostgreSQL + pgvector with system/site/zone metadata filters",
        "deployment_status": provider_status.deployment_status,
        "rag_status": provider_status.rag_status,
        "recommended_scope": recommended_scope,
        "next_step": f"{next_step} {provider_status.next_step_hint}",
    }


def _serialize_run(run: PipelineRun) -> dict:
    return {
        "id": run.id,
        "leader_agent_id": run.leader_agent_id,
        "leader_label": run.leader_agent.label if run.leader_agent else None,
        "batch_label": run.batch_label,
        "status": run.status,
        "collected_records": run.collected_records,
        "redacted_records": run.redacted_records,
        "transmitted_packets": run.transmitted_packets,
        "anomalies_found": run.anomalies_found,
        "integrity_score": round(run.integrity_score, 2),
        "started_at": run.started_at,
        "completed_at": run.completed_at,
    }


def _serialize_event(event: ActivityEvent) -> dict:
    return {
        "id": event.id,
        "zone_id": event.zone_id,
        "agent_id": event.agent_id,
        "agent_label": event.agent.label if event.agent else None,
        "event_type": event.event_type,
        "severity": event.severity,
        "message": event.message,
        "abstraction_applied": event.abstraction_applied,
        "integrity_score": round(event.integrity_score, 2),
        "created_at": event.created_at,
    }


def _serialize_sensitive_record(record: SensitiveRecord, viewer: User) -> dict:
    can_view_raw = user_can_view_sensitive(viewer)

    return {
        "id": record.id,
        "zone_id": record.zone_id,
        "zone_label": record.zone.label,
        "pseudonym_id": record.pseudonym_id,
        "classification": record.classification,
        "handling_status": record.handling_status,
        "redaction_state": "clearance-granted" if can_view_raw else record.redaction_state,
        "source_agency": record.source_agency,
        "abstracted_summary": record.abstracted_summary,
        "subject_name": record.subject_name if can_view_raw else mask_name(record.subject_name),
        "government_identifier": (
            record.government_identifier
            if can_view_raw
            else mask_identifier(record.government_identifier)
        ),
        "phone_number": record.phone_number if can_view_raw else mask_phone(record.phone_number),
        "address": record.address if can_view_raw else mask_address(record.address),
        "case_reference": (
            record.case_reference if can_view_raw else mask_case_reference(record.case_reference)
        ),
        "is_masked": not can_view_raw,
        "created_at": record.created_at,
    }

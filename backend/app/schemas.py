from datetime import datetime

from pydantic import BaseModel, Field


class AgentResponse(BaseModel):
    id: int
    code: str
    label: str
    role: str
    is_leader: bool
    status: str
    security_clearance: str
    encryption_state: str
    checksum_state: str
    abstraction_level: str
    heartbeat_at: datetime


class ActivityEventResponse(BaseModel):
    id: int
    zone_id: int
    agent_id: int | None
    agent_label: str | None
    event_type: str
    severity: str
    message: str
    abstraction_applied: bool
    integrity_score: float
    created_at: datetime


class PipelineRunResponse(BaseModel):
    id: int
    leader_agent_id: int | None
    leader_label: str | None
    batch_label: str
    status: str
    collected_records: int
    redacted_records: int
    transmitted_packets: int
    anomalies_found: int
    integrity_score: float
    started_at: datetime
    completed_at: datetime


class ZoneResponse(BaseModel):
    id: int
    code: str
    label: str
    city: str
    country: str
    system_code: str | None
    system_label: str | None
    site_code: str | None
    site_label: str | None
    region: str | None
    timezone: str | None
    latitude: float | None
    longitude: float | None
    provider: str | None
    network_posture: str | None
    messaging_stack: str | None
    leader_election_stack: str | None
    compute_stack: str | None
    security_stack: str | None
    storage_stack: str | None
    monitoring_stack: str | None
    sensitivity_tier: str
    abstraction_mode: str
    integrity_score: float
    secure_transfer_rate: float
    last_election_at: datetime
    leader_agent_id: int | None
    leader_label: str | None
    agents: list[AgentResponse]
    latest_run: PipelineRunResponse | None
    recent_events: list[ActivityEventResponse]


class DashboardSummaryResponse(BaseModel):
    total_zones: int
    total_agents: int
    active_leaders: int
    healthy_zones: int
    redacted_records: int
    transmitted_packets: int
    average_integrity: float
    secure_transfer_rate: float


class TopologyResponse(BaseModel):
    systems: int
    sites: int
    regions: int
    zones: int
    agents_per_zone: int
    leader_role: str
    protection_model: str
    access_model: str


class ViewerResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    clearance_level: str
    assigned_zones: list[str]
    assigned_systems: list[str]
    assigned_sites: list[str]
    can_view_sensitive: bool
    can_view_audit_logs: bool
    can_manage_users: bool
    can_run_simulation: bool
    can_request_unmask: bool
    can_review_unmask: bool
    masked_by_default: bool
    approval_authority: str
    workspace_home: str


class SecurityContextResponse(BaseModel):
    masked_view: bool
    visible_zones: int
    can_view_sensitive: bool
    can_view_audit_logs: bool
    can_manage_users: bool
    can_run_simulation: bool
    can_request_unmask: bool
    can_review_unmask: bool
    active_unmask_grants: int
    pending_unmask_requests: int
    pending_unmask_reviews: int


class SecurityPostureResponse(BaseModel):
    total_sensitive_records: int
    masked_records: int
    active_unmask_grants: int
    pending_unmask_requests: int
    pending_unmask_reviews: int
    expiring_soon_grants: int
    denied_events_24h: int
    active_sessions: int


class RoleDirectoryItemResponse(BaseModel):
    role: str
    label: str
    description: str
    scope: str
    can_view_sensitive: bool
    can_view_audit_logs: bool
    can_manage_users: bool
    can_run_simulation: bool
    can_request_unmask: bool
    can_review_unmask: bool
    approval_authority: str
    login_purpose: str


class ApprovalPolicyResponse(BaseModel):
    requester_roles: list[str]
    reviewer_roles: list[str]
    required_reviewer_role: str
    self_approval_blocked: bool
    raw_access_mode: str
    approval_model: str


class DashboardResponse(BaseModel):
    generated_at: datetime
    viewer: ViewerResponse
    workspace: "WorkspaceResponse"
    ai_readiness: "AIReadinessResponse"
    security_context: SecurityContextResponse
    security_posture: SecurityPostureResponse
    role_directory: list[RoleDirectoryItemResponse]
    approval_policy: ApprovalPolicyResponse
    summary: DashboardSummaryResponse
    topology: TopologyResponse
    systems: list["SystemSummaryResponse"]
    global_locations: list["GlobalLocationResponse"]
    zones: list[ZoneResponse]
    global_events: list[ActivityEventResponse]


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    expires_at: datetime
    user: ViewerResponse


class LogoutResponse(BaseModel):
    status: str


class SensitiveRecordResponse(BaseModel):
    id: int
    zone_id: int
    zone_label: str
    pseudonym_id: str
    classification: str
    handling_status: str
    redaction_state: str
    source_agency: str
    abstracted_summary: str
    subject_name: str
    government_identifier: str
    phone_number: str
    address: str
    case_reference: str
    is_masked: bool
    access_status: str
    approved_until: datetime | None
    latest_request_status: str | None
    can_request_access: bool
    created_at: datetime


class SensitiveRecordsResponse(BaseModel):
    masked_view: bool
    visible_count: int
    records: list[SensitiveRecordResponse]


class AuditLogResponse(BaseModel):
    id: int
    username: str | None
    action: str
    resource_type: str
    resource_id: str | None
    outcome: str
    detail: str | None
    ip_address: str | None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    logs: list[AuditLogResponse]


class AccessRequestCreateRequest(BaseModel):
    record_id: int
    justification: str = Field(min_length=24, max_length=500)


class AccessRequestReviewRequest(BaseModel):
    review_note: str = Field(min_length=12, max_length=400)
    duration_hours: int = Field(default=4, ge=1, le=24)


class AccessRequestRejectRequest(BaseModel):
    review_note: str = Field(min_length=12, max_length=400)


class AccessRequestRevokeRequest(BaseModel):
    review_note: str = Field(min_length=12, max_length=400)


class AccessRequestResponse(BaseModel):
    id: int
    record_id: int
    record_pseudonym: str
    zone_id: int
    zone_label: str
    requester_username: str
    requester_role: str
    reviewer_username: str | None
    reviewer_role: str | None
    required_reviewer_role: str
    status: str
    justification: str
    review_note: str | None
    requested_at: datetime
    reviewed_at: datetime | None
    expires_at: datetime | None
    is_actionable: bool
    is_revokable: bool
    review_block_reason: str | None


class AccessRequestListResponse(BaseModel):
    requests: list[AccessRequestResponse]


class UserAdminResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    clearance_level: str
    is_active: bool
    last_login_at: datetime | None
    assigned_zones: list[str]
    assigned_systems: list[str]
    assigned_sites: list[str]


class UserListResponse(BaseModel):
    users: list[UserAdminResponse]


class SystemSummaryResponse(BaseModel):
    id: int
    code: str
    label: str
    category: str
    deployment_model: str
    stewardship_model: str
    visible_zones: int
    visible_sites: int
    healthy_zones: int
    average_integrity: float


class GlobalLocationResponse(BaseModel):
    id: int
    code: str
    label: str
    city: str
    country: str
    region: str
    timezone: str
    latitude: float
    longitude: float
    residency_tier: str
    visible_zones: int
    active_systems: int
    warning_events: int
    average_integrity: float


class SimulationStageResponse(BaseModel):
    key: str
    label: str
    role: str
    note: str
    detail: str
    metric_display: str | None
    status: str
    agent_id: int
    agent_label: str
    agent_status: str
    security_clearance: str
    encryption_state: str
    checksum_state: str
    abstraction_level: str
    is_leader: bool
    started_at: datetime | None
    completed_at: datetime | None


class SimulationMapFlowResponse(BaseModel):
    id: str
    kind: str
    status: str
    source_zone_id: int
    source_zone_label: str
    source_site_code: str
    source_site_label: str
    source_latitude: float
    source_longitude: float
    target_zone_id: int
    target_zone_label: str
    target_site_code: str
    target_site_label: str
    target_latitude: float
    target_longitude: float
    packet_count: int
    started_at: datetime | None
    completed_at: datetime | None


class SimulationTimelineEventResponse(BaseModel):
    id: str
    zone_id: int
    zone_label: str
    stage_key: str
    event_type: str
    severity: str
    message: str
    created_at: datetime


class SimulationZoneProgressResponse(BaseModel):
    zone_id: int
    zone_code: str
    zone_label: str
    city: str
    country: str
    site_label: str | None
    region: str | None
    latitude: float | None
    longitude: float | None
    status: str
    active_stage_key: str | None
    latest_message: str
    leader_label: str
    batch_label: str
    integrity_score: float
    secure_transfer_rate: float
    anomalies_found: int
    transmitted_packets: int
    stages: list[SimulationStageResponse]


class SimulationRunResponse(BaseModel):
    id: str
    status: str
    started_at: datetime
    completed_at: datetime | None
    total_zones: int
    completed_zones: int
    generated_at: datetime
    error_message: str | None
    timeline_events: list[SimulationTimelineEventResponse]
    map_flows: list[SimulationMapFlowResponse]
    zone_progress: list[SimulationZoneProgressResponse]


class WorkspaceViewResponse(BaseModel):
    key: str
    label: str
    description: str


class WorkspaceResponse(BaseModel):
    home_view: str
    persona_label: str
    persona_summary: str
    available_views: list[WorkspaceViewResponse]


class AIReadinessResponse(BaseModel):
    engineering_assistant_model: str
    research_assistant_model: str
    embedding_model: str
    vector_store: str
    deployment_status: str
    rag_status: str
    recommended_scope: str
    next_step: str


DashboardResponse.model_rebuild()

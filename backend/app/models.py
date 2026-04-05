from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AvailabilityZone(Base):
    __tablename__ = "availability_zones"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(64), unique=True, nullable=False, index=True)
    label = Column(String(120), nullable=False)
    city = Column(String(120), nullable=False)
    country = Column(String(120), nullable=False)
    sensitivity_tier = Column(String(32), nullable=False)
    abstraction_mode = Column(String(32), default="sealed", nullable=False)
    integrity_score = Column(Float, default=99.0, nullable=False)
    secure_transfer_rate = Column(Float, default=100.0, nullable=False)
    leader_agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    last_election_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    agents = relationship(
        "Agent",
        back_populates="zone",
        foreign_keys="Agent.zone_id",
        cascade="all, delete-orphan",
        order_by="Agent.id",
    )
    leader_agent = relationship("Agent", foreign_keys=[leader_agent_id], post_update=True)
    events = relationship(
        "ActivityEvent",
        back_populates="zone",
        cascade="all, delete-orphan",
        order_by=lambda: ActivityEvent.created_at.desc(),
    )
    pipeline_runs = relationship(
        "PipelineRun",
        back_populates="zone",
        cascade="all, delete-orphan",
        order_by=lambda: PipelineRun.started_at.desc(),
    )
    zone_accesses = relationship(
        "UserZoneAccess",
        back_populates="zone",
        cascade="all, delete-orphan",
    )
    sensitive_records = relationship(
        "SensitiveRecord",
        back_populates="zone",
        cascade="all, delete-orphan",
        order_by=lambda: SensitiveRecord.created_at.desc(),
    )
    deployment = relationship(
        "ZoneDeployment",
        back_populates="zone",
        cascade="all, delete-orphan",
        uselist=False,
    )


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("availability_zones.id"), nullable=False, index=True)
    code = Column(String(80), nullable=False, unique=True)
    label = Column(String(120), nullable=False)
    role = Column(String(64), nullable=False)
    is_leader = Column(Boolean, default=False, nullable=False)
    status = Column(String(32), default="active", nullable=False)
    security_clearance = Column(String(32), default="segmented", nullable=False)
    encryption_state = Column(String(32), default="sealed", nullable=False)
    checksum_state = Column(String(32), default="verified", nullable=False)
    abstraction_level = Column(String(32), default="tier-3", nullable=False)
    heartbeat_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    zone = relationship("AvailabilityZone", back_populates="agents", foreign_keys=[zone_id])
    events = relationship("ActivityEvent", back_populates="agent")


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("availability_zones.id"), nullable=False, index=True)
    leader_agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    batch_label = Column(String(80), nullable=False)
    status = Column(String(32), default="sealed", nullable=False)
    collected_records = Column(Integer, default=0, nullable=False)
    redacted_records = Column(Integer, default=0, nullable=False)
    transmitted_packets = Column(Integer, default=0, nullable=False)
    anomalies_found = Column(Integer, default=0, nullable=False)
    integrity_score = Column(Float, default=99.0, nullable=False)
    started_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    zone = relationship("AvailabilityZone", back_populates="pipeline_runs")
    leader_agent = relationship("Agent", foreign_keys=[leader_agent_id])


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("availability_zones.id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True, index=True)
    event_type = Column(String(64), nullable=False)
    severity = Column(String(16), default="info", nullable=False)
    message = Column(Text, nullable=False)
    abstraction_applied = Column(Boolean, default=True, nullable=False)
    integrity_score = Column(Float, default=99.0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    zone = relationship("AvailabilityZone", back_populates="events")
    agent = relationship("Agent", back_populates="events")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), unique=True, nullable=False, index=True)
    full_name = Column(String(120), nullable=False)
    role = Column(String(32), nullable=False, index=True)
    clearance_level = Column(String(32), nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    zone_accesses = relationship(
        "UserZoneAccess",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="UserZoneAccess.id",
    )
    sessions = relationship(
        "UserSession",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="UserSession.created_at.desc()",
    )
    audit_logs = relationship(
        "AuditLog",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="AuditLog.created_at.desc()",
    )
    requested_access_requests = relationship(
        "SensitiveAccessRequest",
        back_populates="requester",
        foreign_keys="SensitiveAccessRequest.requester_user_id",
        cascade="all, delete-orphan",
        order_by="SensitiveAccessRequest.requested_at.desc()",
    )
    reviewed_access_requests = relationship(
        "SensitiveAccessRequest",
        back_populates="reviewer",
        foreign_keys="SensitiveAccessRequest.reviewer_user_id",
        order_by="SensitiveAccessRequest.requested_at.desc()",
    )
    system_accesses = relationship(
        "UserSystemAccess",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="UserSystemAccess.id",
    )
    site_accesses = relationship(
        "UserSiteAccess",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="UserSiteAccess.id",
    )


class UserZoneAccess(Base):
    __tablename__ = "user_zone_accesses"
    __table_args__ = (UniqueConstraint("user_id", "zone_id", name="uq_user_zone_access"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    zone_id = Column(Integer, ForeignKey("availability_zones.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="zone_accesses")
    zone = relationship("AvailabilityZone", back_populates="zone_accesses")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="sessions")


class SensitiveRecord(Base):
    __tablename__ = "sensitive_records"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("availability_zones.id"), nullable=False, index=True)
    pseudonym_id = Column(String(64), unique=True, nullable=False, index=True)
    subject_name = Column(String(120), nullable=False)
    government_identifier = Column(String(64), nullable=False)
    phone_number = Column(String(32), nullable=False)
    address = Column(String(255), nullable=False)
    case_reference = Column(String(64), nullable=False)
    source_agency = Column(String(120), nullable=False)
    classification = Column(String(32), nullable=False)
    handling_status = Column(String(32), nullable=False)
    redaction_state = Column(String(32), default="masked", nullable=False)
    abstracted_summary = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    zone = relationship("AvailabilityZone", back_populates="sensitive_records")
    access_requests = relationship(
        "SensitiveAccessRequest",
        back_populates="record",
        cascade="all, delete-orphan",
        order_by=lambda: SensitiveAccessRequest.requested_at.desc(),
    )


class SensitiveAccessRequest(Base):
    __tablename__ = "sensitive_access_requests"

    id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey("sensitive_records.id"), nullable=False, index=True)
    requester_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    reviewer_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    status = Column(String(16), default="pending", nullable=False, index=True)
    justification = Column(Text, nullable=False)
    review_note = Column(Text, nullable=True)
    requested_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    record = relationship("SensitiveRecord", back_populates="access_requests")
    requester = relationship(
        "User",
        back_populates="requested_access_requests",
        foreign_keys=[requester_user_id],
    )
    reviewer = relationship(
        "User",
        back_populates="reviewed_access_requests",
        foreign_keys=[reviewer_user_id],
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String(64), nullable=False, index=True)
    resource_type = Column(String(64), nullable=False)
    resource_id = Column(String(64), nullable=True)
    outcome = Column(String(16), default="success", nullable=False)
    detail = Column(Text, nullable=True)
    ip_address = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="audit_logs")


class MeshSystem(Base):
    __tablename__ = "mesh_systems"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(64), unique=True, nullable=False, index=True)
    label = Column(String(120), nullable=False)
    category = Column(String(80), nullable=False)
    deployment_model = Column(String(80), nullable=False)
    stewardship_model = Column(String(80), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    deployments = relationship(
        "ZoneDeployment",
        back_populates="system",
        cascade="all, delete-orphan",
        order_by="ZoneDeployment.id",
    )
    user_accesses = relationship(
        "UserSystemAccess",
        back_populates="system",
        cascade="all, delete-orphan",
        order_by="UserSystemAccess.id",
    )


class GlobalSite(Base):
    __tablename__ = "global_sites"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(64), unique=True, nullable=False, index=True)
    label = Column(String(120), nullable=False)
    city = Column(String(120), nullable=False)
    country = Column(String(120), nullable=False)
    region = Column(String(80), nullable=False)
    timezone = Column(String(80), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    residency_tier = Column(String(40), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    deployments = relationship(
        "ZoneDeployment",
        back_populates="site",
        cascade="all, delete-orphan",
        order_by="ZoneDeployment.id",
    )
    user_accesses = relationship(
        "UserSiteAccess",
        back_populates="site",
        cascade="all, delete-orphan",
        order_by="UserSiteAccess.id",
    )


class ZoneDeployment(Base):
    __tablename__ = "zone_deployments"
    __table_args__ = (UniqueConstraint("zone_id", name="uq_zone_deployment_zone"),)

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("availability_zones.id"), nullable=False, index=True)
    system_id = Column(Integer, ForeignKey("mesh_systems.id"), nullable=False, index=True)
    site_id = Column(Integer, ForeignKey("global_sites.id"), nullable=False, index=True)
    provider = Column(String(80), nullable=False)
    network_posture = Column(String(80), nullable=False)
    messaging_stack = Column(String(80), default="Kafka", nullable=False)
    leader_election_stack = Column(String(80), default="etcd", nullable=False)
    compute_stack = Column(String(80), default="Kubernetes", nullable=False)
    security_stack = Column(String(120), default="Vault + mTLS", nullable=False)
    storage_stack = Column(String(120), default="S3 + encryption", nullable=False)
    monitoring_stack = Column(String(120), default="Prometheus + Grafana", nullable=False)
    status = Column(String(32), default="active", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    zone = relationship("AvailabilityZone", back_populates="deployment")
    system = relationship("MeshSystem", back_populates="deployments")
    site = relationship("GlobalSite", back_populates="deployments")


class UserSystemAccess(Base):
    __tablename__ = "user_system_accesses"
    __table_args__ = (UniqueConstraint("user_id", "system_id", name="uq_user_system_access"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    system_id = Column(Integer, ForeignKey("mesh_systems.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="system_accesses")
    system = relationship("MeshSystem", back_populates="user_accesses")


class UserSiteAccess(Base):
    __tablename__ = "user_site_accesses"
    __table_args__ = (UniqueConstraint("user_id", "site_id", name="uq_user_site_access"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    site_id = Column(Integer, ForeignKey("global_sites.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="site_accesses")
    site = relationship("GlobalSite", back_populates="user_accesses")

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from . import models  # noqa: F401
from .auth import (
    authenticate_user,
    bearer_scheme,
    create_user_session,
    get_current_user,
    revoke_user_session,
)
from .ai_service import generate_ai_advisory_payload
from .database import Base, SessionLocal, engine, get_db
from .policies import (
    serialize_user_profile,
    user_can_access_zone,
    user_can_manage_users,
    user_can_run_simulation,
    user_can_view_audit_logs,
)
from .schemas import (
    AIAdvisoryRequest,
    AIAdvisoryResponse,
    AccessRequestCreateRequest,
    AccessRequestListResponse,
    AccessRequestRejectRequest,
    AccessRequestRevokeRequest,
    AccessRequestResponse,
    AccessRequestReviewRequest,
    AuditLogListResponse,
    DashboardResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    SensitiveRecordsResponse,
    SimulationRunResponse,
    UserListResponse,
    ViewerResponse,
    ZoneResponse,
)
from .security_controls import (
    LoginRateLimiter,
    build_login_rate_limit_key,
    load_security_settings,
)
from .security_service import (
    approve_access_request,
    create_access_request,
    list_access_requests_payload,
    list_sensitive_records_payload,
    reject_access_request,
    revoke_access_request,
)
from .simulation_service import simulation_manager
from .seed import (
    apply_simulation_tick_preview,
    build_simulation_tick_preview,
    get_dashboard_payload,
    get_zone_payload,
    list_audit_logs_payload,
    list_users_payload,
    record_audit_log,
    seed_database,
)

security_settings = load_security_settings()
login_rate_limiter = LoginRateLimiter(
    security_settings.login_rate_limit_attempts,
    security_settings.login_rate_limit_window_seconds,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path("./data").mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="Integrity Mesh Control Plane",
    description="Monitoring dashboard for multi-zone agent coordination and secure data abstraction.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=security_settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    for header, value in security_settings.security_headers.items():
        response.headers.setdefault(header, value)
    return response


def _get_client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=LoginResponse)
def login(
    credentials: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    ip_address = _get_client_ip(request)
    rate_limit_key = build_login_rate_limit_key(credentials.username, ip_address)
    rate_limit_decision = login_rate_limiter.assess(rate_limit_key)

    if not rate_limit_decision.allowed:
        record_audit_log(
            db,
            action="login",
            resource_type="session",
            outcome="denied",
            detail=f"Login throttled for username '{credentials.username}'",
            ip_address=ip_address,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many failed sign-in attempts. Wait "
                f"{rate_limit_decision.retry_after_seconds} seconds before retrying."
            ),
            headers={"Retry-After": str(rate_limit_decision.retry_after_seconds)},
        )

    user = authenticate_user(db, credentials.username, credentials.password)
    if user is None:
        login_rate_limiter.record_failure(rate_limit_key)
        record_audit_log(
            db,
            action="login",
            resource_type="session",
            outcome="denied",
            detail=f"Failed login attempt for username '{credentials.username}'",
            ip_address=ip_address,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    login_rate_limiter.reset(rate_limit_key)
    token, session = create_user_session(db, user)
    refreshed_user = authenticate_user(db, credentials.username, credentials.password)
    record_audit_log(
        db,
        user=refreshed_user,
        action="login",
        resource_type="session",
        resource_id=str(session.id),
        detail="User authenticated successfully",
        ip_address=ip_address,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": session.expires_at,
        "user": serialize_user_profile(refreshed_user),
    }


@app.post("/api/auth/logout", response_model=LogoutResponse)
def logout(
    request: Request,
    auth_credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if auth_credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    revoke_user_session(db, auth_credentials.credentials)
    record_audit_log(
        db,
        user=current_user,
        action="logout",
        resource_type="session",
        detail="Session revoked",
        ip_address=_get_client_ip(request),
    )
    return {"status": "logged out"}


@app.get("/api/me", response_model=ViewerResponse)
def read_current_user(current_user=Depends(get_current_user)):
    return serialize_user_profile(current_user)


@app.get("/api/dashboard", response_model=DashboardResponse)
def read_dashboard(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payload = get_dashboard_payload(db, current_user)
    record_audit_log(
        db,
        user=current_user,
        action="dashboard-read",
        resource_type="dashboard",
        detail="Loaded dashboard view",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.post("/api/ai/advisory", response_model=AIAdvisoryResponse)
def read_ai_advisory(
    body: AIAdvisoryRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    payload = generate_ai_advisory_payload(
        db,
        current_user,
        active_view=body.active_view.strip() or "global",
        prompt=prompt,
        conversation=[
            {"role": turn.role, "content": turn.content}
            for turn in body.conversation
        ],
    )
    record_audit_log(
        db,
        user=current_user,
        action="ai-advisory-read",
        resource_type="ai-advisory",
        detail=f"Generated read-only AI advisory for {body.active_view.strip() or 'global'} workspace",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.get("/api/zones/{zone_id}", response_model=ZoneResponse)
def read_zone(
    zone_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user_can_access_zone(current_user, zone_id):
        record_audit_log(
            db,
            user=current_user,
            action="zone-read",
            resource_type="zone",
            resource_id=str(zone_id),
            outcome="denied",
            detail="Attempted to access a zone outside assigned scope",
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail="Not allowed to access this zone")

    zone = get_zone_payload(db, zone_id, current_user)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")

    record_audit_log(
        db,
        user=current_user,
        action="zone-read",
        resource_type="zone",
        resource_id=str(zone_id),
        detail="Loaded zone detail",
        ip_address=_get_client_ip(request),
    )
    return zone


@app.get("/api/sensitive-records", response_model=SensitiveRecordsResponse)
def read_sensitive_records(
    request: Request,
    zone_id: int | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        payload = list_sensitive_records_payload(db, current_user, zone_id=zone_id)
    except PermissionError as exc:
        record_audit_log(
            db,
            user=current_user,
            action="records-read",
            resource_type="sensitive-record",
            resource_id=str(zone_id) if zone_id is not None else None,
            outcome="denied",
            detail=str(exc),
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    record_audit_log(
        db,
        user=current_user,
        action="records-read",
        resource_type="sensitive-record",
        resource_id=str(zone_id) if zone_id is not None else None,
        detail=(
            "Loaded sensitive records in raw mode"
            if not payload["masked_view"]
            else "Loaded masked sensitive records"
        ),
        ip_address=_get_client_ip(request),
    )
    return payload


@app.get("/api/access-requests", response_model=AccessRequestListResponse)
def read_access_requests(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payload = list_access_requests_payload(db, current_user)
    record_audit_log(
        db,
        user=current_user,
        action="access-requests-read",
        resource_type="access-request",
        detail="Loaded sensitive access request queue",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.post("/api/access-requests", response_model=AccessRequestResponse)
def submit_access_request(
    body: AccessRequestCreateRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        payload = create_access_request(
            db,
            current_user,
            record_id=body.record_id,
            justification=body.justification,
        )
    except PermissionError as exc:
        record_audit_log(
            db,
            user=current_user,
            action="access-request-create",
            resource_type="access-request",
            resource_id=str(body.record_id),
            outcome="denied",
            detail=str(exc),
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    record_audit_log(
        db,
        user=current_user,
        action="access-request-create",
        resource_type="access-request",
        resource_id=str(body.record_id),
        detail="Submitted unmask request",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.post("/api/access-requests/{request_id}/approve", response_model=AccessRequestResponse)
def approve_sensitive_access_request(
    request_id: int,
    body: AccessRequestReviewRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        payload = approve_access_request(
            db,
            current_user,
            request_id=request_id,
            review_note=body.review_note,
            duration_hours=body.duration_hours,
        )
    except PermissionError as exc:
        record_audit_log(
            db,
            user=current_user,
            action="access-request-approve",
            resource_type="access-request",
            resource_id=str(request_id),
            outcome="denied",
            detail=str(exc),
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    record_audit_log(
        db,
        user=current_user,
        action="access-request-approve",
        resource_type="access-request",
        resource_id=str(request_id),
        detail="Approved temporary raw-data access request",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.post("/api/access-requests/{request_id}/reject", response_model=AccessRequestResponse)
def reject_sensitive_access_request(
    request_id: int,
    body: AccessRequestRejectRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        payload = reject_access_request(
            db,
            current_user,
            request_id=request_id,
            review_note=body.review_note,
        )
    except PermissionError as exc:
        record_audit_log(
            db,
            user=current_user,
            action="access-request-reject",
            resource_type="access-request",
            resource_id=str(request_id),
            outcome="denied",
            detail=str(exc),
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    record_audit_log(
        db,
        user=current_user,
        action="access-request-reject",
        resource_type="access-request",
        resource_id=str(request_id),
        detail="Rejected temporary raw-data access request",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.post("/api/access-requests/{request_id}/revoke", response_model=AccessRequestResponse)
def revoke_sensitive_access_request(
    request_id: int,
    body: AccessRequestRevokeRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        payload = revoke_access_request(
            db,
            current_user,
            request_id=request_id,
            review_note=body.review_note,
        )
    except PermissionError as exc:
        record_audit_log(
            db,
            user=current_user,
            action="access-request-revoke",
            resource_type="access-request",
            resource_id=str(request_id),
            outcome="denied",
            detail=str(exc),
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    record_audit_log(
        db,
        user=current_user,
        action="access-request-revoke",
        resource_type="access-request",
        resource_id=str(request_id),
        detail="Revoked temporary raw-data access grant",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.get("/api/audit-logs", response_model=AuditLogListResponse)
def read_audit_logs(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user_can_view_audit_logs(current_user):
        record_audit_log(
            db,
            user=current_user,
            action="audit-read",
            resource_type="audit-log",
            outcome="denied",
            detail="Attempted to access audit logs without permission",
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail="Audit log access denied")

    payload = list_audit_logs_payload(db, current_user)
    record_audit_log(
        db,
        user=current_user,
        action="audit-read",
        resource_type="audit-log",
        detail="Loaded audit log view",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.get("/api/users", response_model=UserListResponse)
def read_users(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user_can_manage_users(current_user):
        record_audit_log(
            db,
            user=current_user,
            action="users-read",
            resource_type="user",
            outcome="denied",
            detail="Attempted to access the user roster without permission",
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail="User roster access denied")

    payload = list_users_payload(db, current_user)
    record_audit_log(
        db,
        user=current_user,
        action="users-read",
        resource_type="user",
        detail="Loaded user roster",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.get("/api/simulation/runs/active", response_model=SimulationRunResponse | None)
def read_active_simulation_run(current_user=Depends(get_current_user)):
    if not user_can_run_simulation(current_user):
        raise HTTPException(status_code=403, detail="Simulation control denied")
    return simulation_manager.get_active_run()


@app.post("/api/simulation/runs", response_model=SimulationRunResponse)
def start_simulation_run(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user_can_run_simulation(current_user):
        record_audit_log(
            db,
            user=current_user,
            action="simulation-run-start",
            resource_type="simulation",
            outcome="denied",
            detail="Attempted to start a live simulation run without permission",
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail="Simulation control denied")

    payload = simulation_manager.start_run()
    record_audit_log(
        db,
        user=current_user,
        action="simulation-run-start",
        resource_type="simulation",
        resource_id=payload["id"],
        detail="Started or resumed a live simulation run",
        ip_address=_get_client_ip(request),
    )
    return payload


@app.get("/api/simulation/runs/{run_id}", response_model=SimulationRunResponse)
def read_simulation_run(
    run_id: str,
    current_user=Depends(get_current_user),
):
    if not user_can_run_simulation(current_user):
        raise HTTPException(status_code=403, detail="Simulation control denied")

    payload = simulation_manager.get_run(run_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Simulation run not found")
    return payload


@app.get("/api/simulation/runs/{run_id}/stream")
def stream_simulation_run(
    run_id: str,
    current_user=Depends(get_current_user),
):
    if not user_can_run_simulation(current_user):
        raise HTTPException(status_code=403, detail="Simulation control denied")

    try:
        stream = simulation_manager.stream(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Simulation run not found") from exc

    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/simulation/tick", response_model=DashboardResponse)
def run_simulation_tick(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not user_can_run_simulation(current_user):
        record_audit_log(
            db,
            user=current_user,
            action="simulation-tick",
            resource_type="simulation",
            outcome="denied",
            detail="Attempted to run a simulation tick without permission",
            ip_address=_get_client_ip(request),
        )
        raise HTTPException(status_code=403, detail="Simulation control denied")

    if simulation_manager.has_running_run():
        raise HTTPException(
            status_code=409,
            detail="A live simulation run is already in progress",
        )

    preview = build_simulation_tick_preview(db)
    apply_simulation_tick_preview(db, preview)
    payload = get_dashboard_payload(db, current_user)
    record_audit_log(
        db,
        user=current_user,
        action="simulation-tick",
        resource_type="simulation",
        detail="Executed simulation tick",
        ip_address=_get_client_ip(request),
    )
    return payload

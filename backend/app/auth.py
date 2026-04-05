from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .database import get_db
from .models import (
    AvailabilityZone,
    GlobalSite,
    MeshSystem,
    User,
    UserSession,
    UserSiteAccess,
    UserSystemAccess,
    UserZoneAccess,
    ZoneDeployment,
    utcnow,
)


SESSION_TTL_HOURS = 12
MAX_ACTIVE_SESSIONS = 4
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return f"{salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt_hex, hash_hex = stored_hash.split("$", maxsplit=1)
    salt = bytes.fromhex(salt_hex)
    expected = bytes.fromhex(hash_hex)
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return secrets.compare_digest(candidate, expected)


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(
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
            selectinload(User.system_accesses)
            .selectinload(UserSystemAccess.system)
            .selectinload(MeshSystem.deployments),
            selectinload(User.site_accesses)
            .selectinload(UserSiteAccess.site)
            .selectinload(GlobalSite.deployments),
        )
    )
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_user_session(db: Session, user: User) -> tuple[str, UserSession]:
    _prune_user_sessions(db, user.id)
    token = secrets.token_urlsafe(32)
    session = UserSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        expires_at=utcnow() + timedelta(hours=SESSION_TTL_HOURS),
        last_seen_at=utcnow(),
    )
    user.last_login_at = utcnow()
    db.add(session)
    db.commit()
    db.refresh(session)
    return token, session


def revoke_user_session(db: Session, token: str) -> None:
    token_hash = hash_session_token(token)
    session = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash))
    if session is not None:
        db.delete(session)
        db.commit()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    token_hash = hash_session_token(credentials.credentials)
    session = db.scalar(
        select(UserSession)
        .where(UserSession.token_hash == token_hash)
        .options(
            selectinload(UserSession.user)
            .selectinload(User.zone_accesses)
            .selectinload(UserZoneAccess.zone)
            .selectinload(AvailabilityZone.deployment)
            .selectinload(ZoneDeployment.system),
            selectinload(UserSession.user)
            .selectinload(User.zone_accesses)
            .selectinload(UserZoneAccess.zone)
            .selectinload(AvailabilityZone.deployment)
            .selectinload(ZoneDeployment.site),
            selectinload(UserSession.user)
            .selectinload(User.system_accesses)
            .selectinload(UserSystemAccess.system)
            .selectinload(MeshSystem.deployments),
            selectinload(UserSession.user)
            .selectinload(User.site_accesses)
            .selectinload(UserSiteAccess.site)
            .selectinload(GlobalSite.deployments),
        )
    )
    if session is None or _normalize_datetime(session.expires_at) <= utcnow():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid",
        )

    session.last_seen_at = utcnow()
    db.commit()
    return session.user


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _prune_user_sessions(db: Session, user_id: int) -> None:
    sessions = list(
        db.scalars(
            select(UserSession)
            .where(UserSession.user_id == user_id)
            .order_by(UserSession.created_at.desc())
        )
    )

    changed = False
    for session in sessions:
        if _normalize_datetime(session.expires_at) <= utcnow():
            db.delete(session)
            changed = True

    remaining_sessions = [
        session
        for session in sessions
        if _normalize_datetime(session.expires_at) > utcnow()
    ]
    for session in remaining_sessions[MAX_ACTIVE_SESSIONS - 1 :]:
        db.delete(session)
        changed = True

    if changed:
        db.commit()


def _normalize_datetime(value):
    if value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)

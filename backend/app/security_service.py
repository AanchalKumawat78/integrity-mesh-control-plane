from __future__ import annotations

from datetime import timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .models import (
    AuditLog,
    SensitiveAccessRequest,
    SensitiveRecord,
    User,
    UserSession,
    utcnow,
)
from .policies import (
    build_security_context,
    mask_address,
    mask_case_reference,
    mask_identifier,
    mask_name,
    mask_phone,
    user_can_access_zone,
    user_can_request_unmask,
    user_can_review_unmask,
    user_has_global_scope,
)


EXPIRING_SOON_HOURS = 2
DEFAULT_APPROVAL_HOURS = 4
MAX_APPROVAL_HOURS = 24
MIN_JUSTIFICATION_LENGTH = 24
MAX_JUSTIFICATION_LENGTH = 500
MIN_REVIEW_NOTE_LENGTH = 12
MAX_REVIEW_NOTE_LENGTH = 400


def list_sensitive_records_payload(
    db: Session,
    viewer: User,
    zone_id: int | None = None,
) -> dict:
    _expire_access_requests(db)

    if zone_id is not None and not user_can_access_zone(viewer, zone_id):
        raise PermissionError("Not allowed to view this zone")

    records = list(
        db.scalars(
            select(SensitiveRecord)
            .options(selectinload(SensitiveRecord.zone))
            .order_by(SensitiveRecord.created_at.desc())
        )
    )
    visible_records = [
        record
        for record in records
        if user_can_access_zone(viewer, record.zone_id)
        and (zone_id is None or record.zone_id == zone_id)
    ]

    access_map = _get_active_access_map(db, viewer, [record.id for record in visible_records])
    latest_request_map = _get_latest_request_map(
        db,
        viewer,
        [record.id for record in visible_records],
    )

    serialized_records = [
        _serialize_sensitive_record(
            record,
            viewer,
            active_request=access_map.get(record.id),
            latest_request=latest_request_map.get(record.id),
        )
        for record in visible_records
    ]

    return {
        "masked_view": all(record["is_masked"] for record in serialized_records),
        "visible_count": len(visible_records),
        "records": serialized_records,
    }


def list_access_requests_payload(db: Session, viewer: User) -> dict:
    _expire_access_requests(db)

    query = (
        select(SensitiveAccessRequest)
        .options(
            selectinload(SensitiveAccessRequest.record).selectinload(SensitiveRecord.zone),
            selectinload(SensitiveAccessRequest.requester),
            selectinload(SensitiveAccessRequest.reviewer),
        )
        .order_by(SensitiveAccessRequest.requested_at.desc())
    )

    if user_can_review_unmask(viewer):
        requests = list(db.scalars(query))
    else:
        requests = list(
            db.scalars(
                query.where(SensitiveAccessRequest.requester_user_id == viewer.id)
            )
        )

    visible_requests = [
        request
        for request in requests
        if user_can_access_zone(viewer, request.record.zone_id) or user_can_review_unmask(viewer)
    ]

    return {
        "requests": [
            _serialize_access_request(request, viewer)
            for request in visible_requests
        ]
    }


def create_access_request(
    db: Session,
    viewer: User,
    *,
    record_id: int,
    justification: str,
) -> dict:
    _expire_access_requests(db)

    if not user_can_request_unmask(viewer):
        raise PermissionError("Your role cannot request raw record access")
    _validate_text(
        justification,
        minimum=MIN_JUSTIFICATION_LENGTH,
        maximum=MAX_JUSTIFICATION_LENGTH,
        too_short_message="Provide a fuller justification for raw access",
        too_long_message="Justification is too long for the review queue",
    )

    record = db.scalar(
        select(SensitiveRecord)
        .where(SensitiveRecord.id == record_id)
        .options(selectinload(SensitiveRecord.zone))
    )
    if record is None:
        raise LookupError("Sensitive record not found")
    if not user_can_access_zone(viewer, record.zone_id):
        raise PermissionError("You cannot request access for this zone")

    existing_pending = db.scalar(
        select(SensitiveAccessRequest)
        .where(
            SensitiveAccessRequest.record_id == record_id,
            SensitiveAccessRequest.requester_user_id == viewer.id,
            SensitiveAccessRequest.status == "pending",
        )
    )
    if existing_pending is not None:
        raise ValueError("A pending access request already exists for this record")

    request = SensitiveAccessRequest(
        record_id=record.id,
        requester_user_id=viewer.id,
        justification=justification.strip(),
        status="pending",
    )
    db.add(request)
    db.commit()
    db.refresh(request)

    hydrated = db.scalar(
        select(SensitiveAccessRequest)
        .where(SensitiveAccessRequest.id == request.id)
        .options(
            selectinload(SensitiveAccessRequest.record).selectinload(SensitiveRecord.zone),
            selectinload(SensitiveAccessRequest.requester),
            selectinload(SensitiveAccessRequest.reviewer),
        )
    )
    return _serialize_access_request(hydrated, viewer)


def approve_access_request(
    db: Session,
    reviewer: User,
    *,
    request_id: int,
    review_note: str,
    duration_hours: int,
) -> dict:
    _expire_access_requests(db)

    if not user_can_review_unmask(reviewer):
        raise PermissionError("You are not allowed to review access requests")
    _validate_text(
        review_note,
        minimum=MIN_REVIEW_NOTE_LENGTH,
        maximum=MAX_REVIEW_NOTE_LENGTH,
        too_short_message="Reviewer note must explain the approval decision",
        too_long_message="Reviewer note is too long",
    )

    access_request = _load_access_request(db, request_id)
    if access_request is None:
        raise LookupError("Access request not found")
    if access_request.status != "pending":
        raise ValueError("Only pending requests can be approved")
    if access_request.requester_user_id == reviewer.id:
        raise PermissionError("Self-approval is blocked by policy")

    normalized_duration = min(max(duration_hours or DEFAULT_APPROVAL_HOURS, 1), MAX_APPROVAL_HOURS)
    now = utcnow()

    access_request.status = "approved"
    access_request.reviewer_user_id = reviewer.id
    access_request.review_note = review_note.strip()
    access_request.reviewed_at = now
    access_request.expires_at = now + timedelta(hours=normalized_duration)
    db.commit()

    return _serialize_access_request(_load_access_request(db, request_id), reviewer)


def reject_access_request(
    db: Session,
    reviewer: User,
    *,
    request_id: int,
    review_note: str,
) -> dict:
    _expire_access_requests(db)

    if not user_can_review_unmask(reviewer):
        raise PermissionError("You are not allowed to review access requests")
    _validate_text(
        review_note,
        minimum=MIN_REVIEW_NOTE_LENGTH,
        maximum=MAX_REVIEW_NOTE_LENGTH,
        too_short_message="Reviewer note must explain the rejection",
        too_long_message="Reviewer note is too long",
    )

    access_request = _load_access_request(db, request_id)
    if access_request is None:
        raise LookupError("Access request not found")
    if access_request.status != "pending":
        raise ValueError("Only pending requests can be rejected")
    if access_request.requester_user_id == reviewer.id:
        raise PermissionError("Self-rejection is blocked by policy")

    access_request.status = "rejected"
    access_request.reviewer_user_id = reviewer.id
    access_request.review_note = review_note.strip()
    access_request.reviewed_at = utcnow()
    access_request.expires_at = None
    db.commit()

    return _serialize_access_request(_load_access_request(db, request_id), reviewer)


def revoke_access_request(
    db: Session,
    reviewer: User,
    *,
    request_id: int,
    review_note: str,
) -> dict:
    _expire_access_requests(db)

    if not user_can_review_unmask(reviewer):
        raise PermissionError("You are not allowed to revoke access requests")
    _validate_text(
        review_note,
        minimum=MIN_REVIEW_NOTE_LENGTH,
        maximum=MAX_REVIEW_NOTE_LENGTH,
        too_short_message="Reviewer note must explain the revocation",
        too_long_message="Reviewer note is too long",
    )

    access_request = _load_access_request(db, request_id)
    if access_request is None:
        raise LookupError("Access request not found")
    if access_request.status != "approved" or _is_expired(access_request.expires_at):
        raise ValueError("Only active approved requests can be revoked")

    access_request.status = "revoked"
    access_request.reviewer_user_id = reviewer.id
    access_request.review_note = review_note.strip()
    access_request.reviewed_at = utcnow()
    access_request.expires_at = utcnow()
    db.commit()

    return _serialize_access_request(_load_access_request(db, request_id), reviewer)


def get_security_posture_payload(db: Session, viewer: User | None = None) -> dict:
    _expire_access_requests(db)

    visible_records = list(
        db.scalars(
            select(SensitiveRecord)
            .options(selectinload(SensitiveRecord.zone))
            .order_by(SensitiveRecord.id)
        )
    )
    if viewer is not None:
        visible_records = [
            record for record in visible_records if user_can_access_zone(viewer, record.zone_id)
        ]

    visible_record_ids = [record.id for record in visible_records]
    visible_request_ids = [
        request.id
        for request in _visible_requests(db, viewer)
    ]

    visible_requests = _visible_requests(db, viewer)
    active_request_ids = {
        request.record_id
        for request in visible_requests
        if request.status == "approved" and not _is_expired(request.expires_at)
    }
    active_unmask_grants = len(active_request_ids)
    pending_unmask_requests = sum(1 for request in visible_requests if request.status == "pending")
    pending_unmask_reviews = (
        pending_unmask_requests if viewer is not None and user_can_review_unmask(viewer) else 0
    )
    expiring_soon_grants = sum(
        1
        for request in visible_requests
        if request.status == "approved" and _expires_soon(request.expires_at)
    )

    denied_events_24h = db.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.outcome == "denied",
            AuditLog.created_at >= utcnow() - timedelta(hours=24),
        )
    ) or 0

    active_sessions = sum(
        1
        for session in db.scalars(select(UserSession))
        if not _is_expired(session.expires_at)
    )

    return {
        "total_sensitive_records": len(visible_record_ids),
        "masked_records": max(len(visible_record_ids) - active_unmask_grants, 0),
        "active_unmask_grants": active_unmask_grants,
        "pending_unmask_requests": pending_unmask_requests,
        "pending_unmask_reviews": pending_unmask_reviews,
        "expiring_soon_grants": expiring_soon_grants,
        "denied_events_24h": denied_events_24h,
        "active_sessions": active_sessions,
    }


def build_enriched_security_context(db: Session, viewer: User | None, visible_zone_count: int) -> dict:
    if viewer is None:
        personal_active_unmask_grants = 0
        personal_pending_unmask_requests = 0
        pending_unmask_reviews = 0
    else:
        personal_requests = list(
            db.scalars(
                select(SensitiveAccessRequest).where(
                    SensitiveAccessRequest.requester_user_id == viewer.id
                )
            )
        )
        personal_active_unmask_grants = sum(
            1
            for request in personal_requests
            if request.status == "approved" and not _is_expired(request.expires_at)
        )
        personal_pending_unmask_requests = sum(
            1 for request in personal_requests if request.status == "pending"
        )
        pending_unmask_reviews = (
            db.scalar(
                select(func.count(SensitiveAccessRequest.id)).where(
                    SensitiveAccessRequest.status == "pending"
                )
            )
            or 0
        ) if user_can_review_unmask(viewer) else 0

    return build_security_context(
        viewer,
        visible_zone_count,
        active_unmask_grants=personal_active_unmask_grants,
        pending_unmask_requests=personal_pending_unmask_requests,
        pending_unmask_reviews=pending_unmask_reviews,
    )


def _visible_requests(db: Session, viewer: User | None) -> list[SensitiveAccessRequest]:
    requests = list(
        db.scalars(
            select(SensitiveAccessRequest)
            .options(
                selectinload(SensitiveAccessRequest.record).selectinload(SensitiveRecord.zone),
                selectinload(SensitiveAccessRequest.requester),
                selectinload(SensitiveAccessRequest.reviewer),
            )
            .order_by(SensitiveAccessRequest.requested_at.desc())
        )
    )

    if viewer is None:
        return requests
    if user_can_review_unmask(viewer):
        return requests
    return [
        request
        for request in requests
        if request.requester_user_id == viewer.id
    ]


def _load_access_request(db: Session, request_id: int) -> SensitiveAccessRequest | None:
    return db.scalar(
        select(SensitiveAccessRequest)
        .where(SensitiveAccessRequest.id == request_id)
        .options(
            selectinload(SensitiveAccessRequest.record).selectinload(SensitiveRecord.zone),
            selectinload(SensitiveAccessRequest.requester),
            selectinload(SensitiveAccessRequest.reviewer),
        )
    )


def _get_active_access_map(
    db: Session,
    viewer: User,
    record_ids: list[int],
) -> dict[int, SensitiveAccessRequest]:
    if not record_ids:
        return {}

    requests = list(
        db.scalars(
            select(SensitiveAccessRequest)
            .where(
                SensitiveAccessRequest.record_id.in_(record_ids),
                SensitiveAccessRequest.requester_user_id == viewer.id,
                SensitiveAccessRequest.status == "approved",
            )
            .order_by(SensitiveAccessRequest.reviewed_at.desc())
        )
    )

    active_map: dict[int, SensitiveAccessRequest] = {}
    for request in requests:
        if _is_expired(request.expires_at):
            continue
        active_map.setdefault(request.record_id, request)
    return active_map


def _get_latest_request_map(
    db: Session,
    viewer: User,
    record_ids: list[int],
) -> dict[int, SensitiveAccessRequest]:
    if not record_ids:
        return {}

    requests = list(
        db.scalars(
            select(SensitiveAccessRequest)
            .where(
                SensitiveAccessRequest.record_id.in_(record_ids),
                SensitiveAccessRequest.requester_user_id == viewer.id,
            )
            .order_by(SensitiveAccessRequest.requested_at.desc())
        )
    )

    latest_map: dict[int, SensitiveAccessRequest] = {}
    for request in requests:
        latest_map.setdefault(request.record_id, request)
    return latest_map


def _serialize_access_request(
    access_request: SensitiveAccessRequest,
    viewer: User,
) -> dict:
    pending_review = access_request.status == "pending"
    self_review_blocked = pending_review and access_request.requester_user_id == viewer.id

    return {
        "id": access_request.id,
        "record_id": access_request.record_id,
        "record_pseudonym": access_request.record.pseudonym_id,
        "zone_id": access_request.record.zone_id,
        "zone_label": access_request.record.zone.label,
        "requester_username": access_request.requester.username,
        "requester_role": access_request.requester.role,
        "reviewer_username": access_request.reviewer.username if access_request.reviewer else None,
        "reviewer_role": access_request.reviewer.role if access_request.reviewer else None,
        "required_reviewer_role": "security_officer",
        "status": access_request.status,
        "justification": access_request.justification,
        "review_note": access_request.review_note,
        "requested_at": access_request.requested_at,
        "reviewed_at": access_request.reviewed_at,
        "expires_at": access_request.expires_at,
        "is_actionable": (
            user_can_review_unmask(viewer)
            and pending_review
            and not self_review_blocked
        ),
        "is_revokable": (
            user_can_review_unmask(viewer)
            and access_request.status == "approved"
            and not _is_expired(access_request.expires_at)
        ),
        "review_block_reason": (
            "Self-approval is blocked by policy. Use a different reviewer account."
            if user_can_review_unmask(viewer) and self_review_blocked
            else None
        ),
    }


def _serialize_sensitive_record(
    record: SensitiveRecord,
    viewer: User,
    *,
    active_request: SensitiveAccessRequest | None,
    latest_request: SensitiveAccessRequest | None,
) -> dict:
    can_view_raw = active_request is not None and not _is_expired(active_request.expires_at)

    if can_view_raw:
        access_status = "approved"
    elif latest_request is not None and latest_request.status == "pending":
        access_status = "pending-review"
    elif latest_request is not None and latest_request.status == "rejected":
        access_status = "rejected"
    elif latest_request is not None and latest_request.status == "revoked":
        access_status = "revoked"
    elif latest_request is not None and latest_request.status == "expired":
        access_status = "expired"
    else:
        access_status = "masked"

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
        "access_status": access_status,
        "approved_until": active_request.expires_at if can_view_raw else None,
        "latest_request_status": latest_request.status if latest_request else None,
        "can_request_access": (
            user_can_request_unmask(viewer)
            and active_request is None
            and (
                latest_request is None
                or latest_request.status in {"rejected", "expired", "revoked"}
            )
        ),
        "created_at": record.created_at,
    }


def _expire_access_requests(db: Session) -> None:
    requests = list(
        db.scalars(
            select(SensitiveAccessRequest).where(SensitiveAccessRequest.status == "approved")
        )
    )
    changed = False
    for request in requests:
        if _is_expired(request.expires_at):
            request.status = "expired"
            changed = True

    if changed:
        db.commit()


def _validate_text(
    value: str,
    *,
    minimum: int,
    maximum: int,
    too_short_message: str,
    too_long_message: str,
) -> None:
    normalized_value = value.strip()
    if len(normalized_value) < minimum:
        raise ValueError(too_short_message)
    if len(normalized_value) > maximum:
        raise ValueError(too_long_message)


def _is_expired(value) -> bool:
    if value is None:
        return False
    return _normalize_datetime(value) <= utcnow()


def _expires_soon(value) -> bool:
    if value is None:
        return False
    normalized = _normalize_datetime(value)
    return utcnow() < normalized <= utcnow() + timedelta(hours=EXPIRING_SOON_HOURS)


def _normalize_datetime(value):
    if value is None:
        return None
    if value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)

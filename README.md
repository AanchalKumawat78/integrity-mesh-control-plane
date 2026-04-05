# Integrity Mesh Control Plane

A starter full-stack platform for monitoring a five-zone distributed agent mesh:

- `5` availability zones across the world
- `5` agents per zone
- one leader per zone, with the `data-transfer` agent preferred as leader
- a protected flow from collection -> preprocessing -> analysis -> validation -> transfer
- visibility into integrity score, abstraction volume, secure transfer rate, and zone events
- seeded user accounts with role-based zone scope, masked record views, audit logging, temporary unmask approvals, and reviewer-led revocation
- role-based login guidance and approval boundaries surfaced in the dashboard UI

## Stack

- Frontend: React + Vite
- Backend: FastAPI + SQLAlchemy
- Database: SQLite
- Containers: Docker Compose + Kubernetes manifests

## Project Layout

- `backend/` FastAPI API, SQLite models, seeded simulation data, tests
- `frontend/` React dashboard for zone and agent visibility
- `k8s/` deployment manifests

## Run Locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend API: `http://localhost:8000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend UI: `http://localhost:5173`

## Docker Compose

```bash
docker compose up --build
```

Frontend UI: `http://localhost:5173`

## API Endpoints

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/dashboard`
- `GET /api/zones/{zone_id}`
- `GET /api/sensitive-records`
- `GET /api/access-requests`
- `POST /api/access-requests`
- `POST /api/access-requests/{id}/approve`
- `POST /api/access-requests/{id}/reject`
- `POST /api/access-requests/{id}/revoke`
- `GET /api/audit-logs`
- `GET /api/users`
- `POST /api/simulation/tick`

## Demo Accounts

- `security / shield123`
- `security.reviewer / review123`
- `admin / admin123`
- `atlantic.operator / zone123`
- `policy.analyst / analyst123`
- `auditor / audit123`

## Security Model In This Prototype

- Sensitive records are masked by default for every role.
- Login is account-based, but every account is mapped to an explicit platform role with a defined approval boundary.
- Operators and analysts can request temporary raw access with a written justification.
- Security reviewers approve or reject those requests with an audit note and expiry window.
- Approved raw access is temporary and can be revoked before expiry.
- Audit logs capture logins, dashboard reads, record reads, request reviews, and denied actions.
- Session count is capped per user and login attempts are rate-limited.
- API responses are returned with no-store cache headers and defensive browser security headers.
- Zone visibility is enforced in the backend, not only in the frontend.

## Environment Variables

- `DATABASE_URL`
- `INTEGRITY_ALLOWED_ORIGINS`
  Example: `http://localhost:5173,http://localhost:5175`
- `INTEGRITY_LOGIN_RATE_LIMIT_ATTEMPTS`
  Default: `5`
- `INTEGRITY_LOGIN_RATE_LIMIT_WINDOW_SECONDS`
  Default: `300`

## Best Approaches For A Real Sensitive-Data Deployment

- Replace SQLite with PostgreSQL and encrypted backups.
- Move authentication to OIDC or SSO with MFA.
- Store encryption keys in a dedicated KMS or HSM-backed secret manager.
- Use mTLS and service identities between agents and backend services.
- Separate raw-data storage from abstracted analytics storage.
- Add approval chains for especially sensitive classifications.
- Add immutable export logging and watermarking for generated reports.
- Add retention and purge policies per classification level.
- Add intrusion alerts for repeated denials, unusual session fan-out, and cross-zone anomalies.
- Put the app behind TLS termination, WAF rules, and centralized audit shipping.

## Notes

- The current build is a monitoring and simulation starter for your architecture, not a production-grade distributed control plane yet.
- SQLite is fine for this prototype because you asked for it, but for a real multi-region production system you should move the control-plane database to PostgreSQL or another replicated datastore.
- The dashboard is seeded with five real regions and simulates leader failover when the preferred transfer agent degrades.
- Temporary raw-data access is now modeled as a request-review-expire-revoke lifecycle rather than a permanent role privilege.

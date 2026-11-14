# Security model

What protects CarbonRoute today, how each control is verified, and which risks are accepted. Status
labels: **tested** (automated test in the repository), **CI** (runs on every pull request),
**reviewed** (inspected, no automated test), **open** (known, not fixed).

## Identity and sessions

| Control | Detail | Status |
|---|---|---|
| Passwords | bcrypt (cost 10); at least 12 characters; known defaults refused; never logged or returned | tested, CI |
| No default credentials | production refuses to start without a strong `JWT_SECRET`; the initial admin needs `ADMIN_PASSWORD` | tested, CI |
| Tokens | HS256 JWT, algorithm pinned on verification, unique `jti`; default lifetime **12 h** (P8; was 7 days) | tested, CI |
| Logout | the token's `jti` is revoked server-side and rejected afterwards | tested, CI |
| Password change | `POST /auth/password` needs the current password; every older token, on every device, stops working (P8) | tested, CI |
| Login enumeration | unknown usernames cost the same bcrypt work as wrong passwords; identical message (P8) | tested, CI |
| Login throttling | per account and per address (`RATE_LIMIT_LOGIN_*`), 429 with `Retry-After` | tested, CI |
| Accounts | no public self-registration; administrators create accounts (`POST /admin/users`, P8) or `npm run user:create` | tested, CI |

## Authorisation

| Control | Detail | Status |
|---|---|---|
| Job ownership | every job route checks the owner; another user's job id answers 404 (no probing) | tested, CI |
| Administrators | may act on any job; each such action is written to the audit log | tested, CI |
| Admin routes | uploads, content edits, audit log and account management require `admin` | tested, CI |

## Input, output and transport

| Control | Detail | Status |
|---|---|---|
| CORS | explicit allow-list (`CORS_ORIGIN`), no wildcard with credentials; unknown origins get no CORS headers | tested, CI |
| CSP | `default-src 'self'`, `script-src 'self'`, `frame-ancestors` limited to the allow-list (helmet) | tested, CI |
| Request size | JSON bodies limited to 1 MB (413), P8 | tested, CI |
| Errors | unexpected errors return a generic message and a reference id; details only in the server log (P8) | tested, CI |
| File serving | `/storage` serves only two folders and a single file name; path traversal refused | tested, CI |
| Workload specs | images must be valid references; commands may not contain control characters | tested, CI |
| Kubernetes | manifests built as objects and applied as JSON; `kubectl` run with `execFile` argument arrays (no shell); pods unprivileged, all capabilities dropped, no service-account token | tested, CI |
| Cluster status | public endpoint returns availability only (never `kubectl` output, which names the control plane); one cached probe per 30 s (P8) | tested, CI |

## Resource and quota protection

| Control | Detail | Status |
|---|---|---|
| Live carbon data | requires sign-in; per-user limit; server-wide provider call budget (429 `QUOTA_GUARD`) | tested, CI |
| Job actions | per-user limit | tested, CI |
| Public compute | `/scheduler/simulate` and `/cluster/health` limited per address (P8) | tested, CI |
| Collector | one collector per folder (OS-enforced socket lock); appends fenced by ownership | tested, CI (incl. multi-process stress) |

## Secrets

- Only in environment variables (`.env`, git-ignored) or the host's secret settings. `.dockerignore`
  keeps `.env` and local databases out of images (verified in CI with decoy files).
- Values that were once committed (old default admin password, old JWT secrets) are treated as public
  and must never be reused. Local credentials were rotated; **hosted credentials have not been**
  (the old hosted backend is suspended; see DEPLOYMENT_READINESS.md).
- Tests never read the real `.env` secrets and make no provider calls.

## Accepted and open risks

| Risk | Why accepted / plan |
|---|---|
| **Token in `localStorage`** (readable by injected script) | Cross-origin deployment (Pages frontend, separate backend) would need `SameSite=None` cookies plus CSRF protection. Mitigated by CSP, no inline scripts, and the 12 h lifetime. Planned: httpOnly cookie sessions (roadmap M14.7). **open** |
| In-memory rate limits and revocation cache | single process only; a restart resets limits (revocations are persisted). **open** for multi-instance deployments |
| JSON-file database | no concurrent writers; must be on a persistent disk. **open** |
| bcrypt in the request thread | each login blocks the event loop ~60–100 ms; acceptable at demo scale |
| Old hosted backend | suspended and verified unavailable; secrets in git history must be replaced on any new deployment |

## How to report a problem

Open a private issue with the repository owner or contact the team; do not include secrets or tokens.

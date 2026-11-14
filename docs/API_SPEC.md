# CarbonRoute REST API Specification

## Base URL
`/api`

---

## 1. Authentication Endpoints

### `POST /auth/login`
Authenticates an administrator or evaluator.
- **Request Body**:
  ```json
  {
    "username": "admin",
    "password": "<your admin password>"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid",
      "username": "admin",
      "email": "admin@carbonroute.org",
      "role": "admin"
    }
  }
  ```

### `GET /auth/me`
Fetches current session user profile from Bearer JWT.
- **Headers**: `Authorization: Bearer <token>`

### `POST /auth/logout`
Ends the session. The token sent with the request is revoked and is rejected from then on.

### Tokens and status codes (M1.2)
- Tokens are HS256 JWTs (no other algorithm is accepted) with a unique id (`jti`).
- A token stops working when it expires, when it is revoked by logout, or when the user's password changes (every older token is rejected).
- **401** `{ "code": "UNAUTHENTICATED" }` with a `WWW-Authenticate: Bearer` header: no token, or an invalid, expired or revoked one.
- **403**: authenticated, but the role lacks the permission (for example a non-admin using an admin route or `GET /jobs?owner=<someone else>`).
- **404** `{ "code": "JOB_NOT_FOUND" }`: the job does not exist **or belongs to another user**. Both cases give the same response, so job ids cannot be probed.

### `POST /auth/password` (signed in; P8)
Body `{ "currentPassword": "...", "newPassword": "..." }`. Requires the current password (401 otherwise);
the new one must be at least 12 characters, not a known default, and differ from the current one
(400). On success **every token issued before the change stops working**, on every device, and the
response carries a new `token`. Rate limited per user (`RATE_LIMIT_PASSWORD_MAX`, 429).

### Accounts
Roles: `admin`, `student`, `evaluator`. Only `admin` has administrator rights. There is **no public
self-registration**: every account can spend the shared Electricity Maps quota, so accounts are issued
by an administrator.

- `GET /admin/users` (admin): accounts without password hashes.
- `POST /admin/users` (admin): `{ "username", "email", "password", "role"? }` (role defaults to
  `student`). 201 with the account; 400 for duplicates, weak passwords, invalid roles or non-text input;
  403 for non-admins.
- From the command line: `NEW_USER_USERNAME=... NEW_USER_EMAIL=... NEW_USER_ROLE=student NEW_USER_PASSWORD=... npm run user:create`
  (in `backend/`, after `npm run build`; the password is read from the environment and never printed).

### Errors (P8)
Unexpected server errors return **500** `{ "message": "Internal server error. (reference abcd1234)", "reference": "abcd1234" }`;
the details are only in the server log under that reference. Malformed JSON is **400**; JSON bodies
over 1 MB are **413**.

---

## 2. Presentation & Versioning Endpoints

### `GET /presentations`
Lists all registered presentation series with latest version tags.

### `GET /presentations/versions`
Lists all published presentation versions (or all versions if authenticated as admin).

### `GET /presentations/v/:versionTag`
Retrieves detailed metadata, checksum, and file URL for a specific version (e.g. `v1`, `v2`, `midterm`, `final`).

### `POST /presentations/upload` (Protected - Admin)
Uploads and registers a new immutable presentation version.
- **Headers**: `Authorization: Bearer <token>`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `file`: Document/PDF file (Max 50MB)
  - `title`: String
  - `versionTag`: String (e.g. `v2`)
  - `presentationDate`: ISO Date string (`YYYY-MM-DD`)
  - `changeSummary`: String
  - `description`: String
  - `isPublished`: Boolean (`true`/`false`)

---

## 3. Storage Streaming Endpoints

### `GET /storage/:category/:fileName`
Streams uploaded files (PDFs, PPTX, reports) from Object Storage with support for inline browser viewing and download headers (`?download=true`).

---

## 4. Jobs (authentication and ownership required, M1.2)

Every route in this section needs `Authorization: Bearer <token>`. A job belongs to the user who created it.
Owners can see and change only their own jobs; administrators can see and change every job (including jobs
stored before M1.2, which have no owner), and their actions on other users' jobs are written to the audit log.
For any other user a job id answers **404**, exactly like an unknown id.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /jobs` | any user | The caller's jobs (admins: all jobs, with `owner` names). Filters: `?status=pending\|scheduled\|infeasible\|running\|completed\|failed\|cancelled\|interrupted`, `?zone=`, `?owner=` (admins only; `me` for anyone, otherwise 403). |
| `POST /jobs` | any user | Register a job. The owner is always the caller (`ownerId` in the body is ignored). |
| `POST /schedule` (`jobData.deadlineAt` / `arrivalAt` must be ISO-8601 **with a time zone**, e.g. `2026-11-14T18:00:00Z` or `…+05:30`; optional `runtimeCv` 0–1) | any user | Schedule `jobData` (new job owned by the caller; an unknown `jobData.id` is replaced by a server id) or an existing `jobId` the caller can access. Cancelled jobs: 409. |
| `GET /jobs/:id` | owner, admin | Job details: latest decision with the stored **policy comparison** (`policies`), structured **`explanation`** (objective, constraints, binding constraint, candidate counts, policy relations, unavailable policies), provenance, energy assumption, latest execution, and an **observation summary** split into measured / provider-estimate / missing counts. |
| `GET /jobs/:id/status`, `/results`, `/manifest` | owner, admin | Execution status and logs, results, Kubernetes manifest. |
| `POST /jobs/:id/dispatch` | owner, admin | Execute (Kubernetes) or simulate the job, once. **409** `NO_RECOMMENDATION` if the job has no recommended window (never scheduled, or infeasible); **409** `JOB_ALREADY_DISPATCHED` while it waits or runs, or after it completed; cancelled jobs: 409. A failed or interrupted run may be dispatched again (P8). |
| `POST /jobs/:id/cancel` | owner, admin | Cancel a job that has not finished (stops a simulated run; deletes the Kubernetes Job on a live cluster). Already cancelled or finished: 409. |
| `POST /jobs/:id/observations`, `GET /jobs/:id/observations` | owner, admin | Collect / read provider observations for the scheduled window. |
| `GET /jobs/:id/report` (`?format=html`) | owner, admin | Report as JSON or a downloadable HTML file. |
| `POST /experiments`, `GET /experiments` | any user | Record / list experiments. Records are owned by the caller (admins see all); a `jobId` must be a job the caller can access. |
| `GET /jobs/:id/oracle` | owner, admin | Hindsight (Oracle) evaluation on realized observations. **Offline evaluation only**; usually unavailable for single jobs (observations exist only for the scheduled and Immediate windows). |
| `GET /results/ml`, `GET /results/ml/:id` | any user | Forecast-error model evaluations (`npm run ml`, see ML.md): status (`insufficient-data` / `evaluated-not-promoted` / `evaluated-promoted`) with reasons, data inventory, thresholds, held-out scores when evaluated. Only `ml-<timestamp>` ids are served. |
| `GET /results/benchmarks`, `GET /results/benchmarks/:id` | any user | Stored benchmark runs (`npm run benchmark`) from `BENCHMARK_RESULTS_DIR`: policy comparison with bootstrap intervals, pending counts, forecast accuracy split by realized quality. Only `benchmark-<timestamp>` ids are served. |

**Execution status (P8)** is persisted on the job's stored execution (`status`, `statusUpdatedAt`, `finishedAt`) and survives a restart. A run that had not finished when the server stopped is reported as `interrupted` (outcome unknown), never as completed. Simulated executions never record energy.

A scheduling request that fails before a decision exists (e.g. the provider is unavailable) stores nothing; an impossible deadline is stored as an `INFEASIBLE` decision.

`/cluster/health` and `/scheduler/simulate` do not use job data and remain public, but are rate limited per address (`RATE_LIMIT_PUBLIC_MAX` per `RATE_LIMIT_PUBLIC_WINDOW_MIN`, defaults 60 per 10 min). `/cluster/health` only says whether a cluster is reachable (cached for 30 s); it never returns `kubectl` output.

### Carbon data and limits (P0)
- Live `/carbon/*` routes (`forecast`, `forecast/snapshot`, `latest`, `history`, `power-breakdown`, `regions`) spend the Electricity Maps quota: they require a token (401 otherwise) and are rate limited per user. With `?mode=demo` (synthetic data) `forecast` and `regions` are public. `GET /carbon/provider` is public and shows the server-wide `callBudget` (no secrets).
- **429** `{ "code": "RATE_LIMITED" }` with `Retry-After`: too many login attempts (per account and per address), job actions or live-data requests. **429** `{ "code": "QUOTA_GUARD" }`: the server's provider call budget is used up.
- Job images must be valid image references and commands may not contain control characters (400 `INVALID_WORKLOAD`).

## 5. Scheduling & Feasibility Simulation

### `POST /scheduler/simulate`
Public feasibility demonstration: the same engine and the same forecast, evaluated with two **declared runtime variabilities** (CV 0.05 and 0.25), showing how the deadline-risk constraint changes the decision. It uses the **synthetic demo trace** (no provider call) and does not model carbon-forecast uncertainty.
- **Request Body**:
  ```json
  {
    "durationHours": 2,
    "deadlineHours": 12,
    "riskTolerance": 0.10
  }
  ```
- **Response `200 OK`**:
  Returns the candidate windows, Scenario A (CV 0.05) and Scenario B (CV 0.25) decisions with their rationale, and `riskModel: "declared-runtime-cv"`. No fallback values are returned on error.

## 6. Health

### `GET /health`
Public. Service status and version; no secrets.

## 7. Offline scripts (not HTTP)

`npm run collect`, `coverage`, `benchmark`, `ml` and `demo` in `backend/` (after `npm run build`). See
[COLLECTOR.md](COLLECTOR.md), [EXPERIMENTS.md](EXPERIMENTS.md), [ML.md](ML.md) and [DEMO.md](DEMO.md).
Their results are read by `GET /results/benchmarks` and `GET /results/ml`.

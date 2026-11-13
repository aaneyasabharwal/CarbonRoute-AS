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

### Accounts
Roles: `admin`, `student`, `evaluator`. Only `admin` has administrator rights. Create accounts with
`NEW_USER_USERNAME=... NEW_USER_EMAIL=... NEW_USER_ROLE=student NEW_USER_PASSWORD=... npm run user:create`
(in `backend/`, after `npm run build`; the password is read from the environment and never printed).

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
| `GET /jobs` | any user | The caller's jobs (admins: all jobs, with `owner` names). Filters: `?status=pending\|scheduled\|infeasible\|running\|completed\|failed\|cancelled`, `?zone=`, `?owner=` (admins only; `me` for anyone, otherwise 403). |
| `POST /jobs` | any user | Register a job. The owner is always the caller (`ownerId` in the body is ignored). |
| `POST /schedule` | any user | Schedule `jobData` (new job owned by the caller; an unknown `jobData.id` is replaced by a server id) or an existing `jobId` the caller can access. Cancelled jobs: 409. |
| `GET /jobs/:id` | owner, admin | Job details, latest decision (forecast snapshot id, windows) and latest execution record. |
| `GET /jobs/:id/status`, `/results`, `/manifest` | owner, admin | Execution status and logs, results, Kubernetes manifest. |
| `POST /jobs/:id/dispatch` | owner, admin | Execute or simulate the job. Cancelled jobs: 409. |
| `POST /jobs/:id/cancel` | owner, admin | Cancel a job that has not finished (stops a simulated run; deletes the Kubernetes Job on a live cluster). Already cancelled or finished: 409. |
| `POST /jobs/:id/observations`, `GET /jobs/:id/observations` | owner, admin | Collect / read provider observations for the scheduled window. |
| `GET /jobs/:id/report` (`?format=html`) | owner, admin | Report as JSON or a downloadable HTML file. |
| `POST /experiments`, `GET /experiments` | any user | Record / list experiments. Records are owned by the caller (admins see all); a `jobId` must be a job the caller can access. |

`/cluster/health` and `/scheduler/simulate` do not use job data and remain public.

### Carbon data and limits (P0)
- Live `/carbon/*` routes (`forecast`, `forecast/snapshot`, `latest`, `history`, `power-breakdown`, `regions`) spend the Electricity Maps quota: they require a token (401 otherwise) and are rate limited per user. With `?mode=demo` (synthetic data) `forecast` and `regions` are public. `GET /carbon/provider` is public and shows the server-wide `callBudget` (no secrets).
- **429** `{ "code": "RATE_LIMITED" }` with `Retry-After`: too many login attempts (per account and per address), job actions or live-data requests. **429** `{ "code": "QUOTA_GUARD" }`: the server's provider call budget is used up.
- Job images must be valid image references and commands may not contain control characters (400 `INVALID_WORKLOAD`).

## 5. Scheduling & Feasibility Simulation

### `POST /scheduler/simulate`
Simulates scheduling decisions under identical carbon forecasts with Low vs High forecast uncertainty.
- **Request Body**:
  ```json
  {
    "durationHours": 2,
    "deadlineHours": 12,
    "riskTolerance": 0.10
  }
  ```
- **Response `200 OK`**:
  Returns time slot profiles, Scenario A (Low Uncertainty) decision, Scenario B (High Uncertainty) decision, and risk calibration rationale.

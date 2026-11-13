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

## 4. Scheduling & Feasibility Simulation

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

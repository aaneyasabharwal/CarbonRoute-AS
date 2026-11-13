# CarbonRoute Production Deployment Guide

## 1. Overview
The CarbonRoute platform is designed to be hosted publicly on a Linux VPS (Ubuntu/Debian), cloud VM (AWS EC2 / GCP Compute Engine / DigitalOcean), or a container orchestrator (Docker Compose / Kubernetes).

---

## 2. Architecture & Data Flow

```
+-------------------------------------------------------------+
| Browser (Public Visitor / University Evaluator / Admin)     |
+-------------------------------------------------------------+
                              | HTTPS (Port 443)
                              v
+-------------------------------------------------------------+
| Nginx Reverse Proxy / SSL Termination                       |
+-------------------------------------------------------------+
         |                                           |
         v (Static assets)                           v (/api & /uploads)
+------------------------------------+   +------------------------------------+
| Frontend React Single-Page App     |   | Backend Express Server (Node.js)   |
+------------------------------------+   +------------------------------------+
                                                           |
                                 +-------------------------+-------------------------+
                                 |                                                   |
                                 v                                                   v
                  +-----------------------------+                     +-----------------------------+
                  | Database (JSON / SQLite /   |                     | Object Storage (AWS S3 /    |
                  | PostgreSQL Relational Store)|                     | Cloudflare R2 / Local Disk) |
                  +-----------------------------+                     +-----------------------------+
```

---

## 3. Environment Variables Configuration

Copy `.env.example` to `.env` and configure secrets:

```bash
NODE_ENV=production
PORT=5000
CORS_ORIGIN=https://carbonroute.org
# Required: 32+ random characters. Generate with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=
JWT_EXPIRES_IN=7d

# Storage Options: 'local' or 's3'
STORAGE_TYPE=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_BUCKET_NAME=carbonroute-presentations-prod

# Initial Admin
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@carbonroute.org
# Required on first start (12+ characters, no default); only used to create the initial admin.
ADMIN_PASSWORD=
```

With `NODE_ENV=production` the backend refuses to start if `JWT_SECRET` is missing, shorter than 32 characters or a value that was ever published in this repository, or if `ADMIN_PASSWORD` is missing when the database has no users. In development a random per-process JWT secret is used instead (sessions end when the server restarts) and no admin is created until `ADMIN_PASSWORD` is set.

### Rotating the admin password

Earlier versions of this repository committed a default admin password and JWT secrets. They remain in git history, so any database or deployment created with them must be treated as compromised:

1. Set a new random `JWT_SECRET` in `.env` (this invalidates all existing tokens).
2. With the server stopped, set a new admin password (read from the environment, never printed):
   ```bash
   cd backend && npm run build
   NEW_ADMIN_PASSWORD='<new password>' npm run admin:set-password
   ```
   Use `ADMIN_USERNAME=<name>` to rotate a different user. The change is recorded in the audit log.
3. Restart the server.

---

### Security settings (P0 hardening)

| Variable | Purpose | Production value |
| --- | --- | --- |
| `CORS_ORIGIN` | Browser origins allowed to call the API with credentials, comma-separated. Others get no CORS headers. The same list is used for CSP `frame-ancestors` (PDF embedding). | Every deployed frontend origin. **Required**: without it only local dev origins work. |
| `TRUST_PROXY` | Lets the server see the client address behind a proxy, for per-address rate limits. Leave empty when not behind a proxy (prevents spoofing). | `1` on Render / behind one proxy |
| `RATE_LIMIT_*` | Login (per account and per address), job actions and live carbon data per user. | Defaults are in `.env.example` |
| `EM_MAX_CALLS_PER_HOUR`, `EM_MAX_CALLS_PER_DAY` | Server-wide Electricity Maps call budget. When it is used up, live data answers 429 `QUOTA_GUARD`; demo mode keeps working. | Set below the plan's limits |

Other hardening:
- Live `/api/carbon/*` data requires sign-in; `?mode=demo` (synthetic) stays public.
- `/api/storage/:category/:file` only serves the `presentations` and `resources` folders and a single file name.
- Kubernetes jobs: the manifest is built as an object and applied as JSON; `kubectl` is run with argument arrays (no shell); images must be valid references; pods run without privilege escalation, with all capabilities dropped and no service-account token.
- The FastAPI service reads the same `CORS_ORIGIN` list and never combines credentials with `*`.
- Third-party binaries are not committed (`*.exe` is git-ignored). To expose a local server with Cloudflare Tunnel, download `cloudflared` from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/.

---

## 4. Docker Production Deployment

Run with Docker Compose:
```bash
docker compose -f docker/docker-compose.yml up -d --build
```
Docker Compose reads secrets from the repository-root `.env` (`env_file`); none are written in `docker/docker-compose.yml`.

This starts:
- `carbonroute-backend`: Express API server on port 5000
- `carbonroute-frontend`: High-performance Nginx web server serving the compiled React bundle on port 80/443.

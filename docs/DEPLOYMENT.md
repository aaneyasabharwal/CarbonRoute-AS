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
                  | Database (JSON files,       |                     | Object Storage (AWS S3 /    |
                  | single process)             |                     | Cloudflare R2 / Local Disk) |
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
- `carbonroute-frontend`: nginx serving the compiled React bundle on port 80 and proxying `/api` and
  `/uploads` to the backend. The image is built with `VITE_API_URL=/api`, so the browser calls the API
  on the same origin; compose sets `CORS_ORIGIN=http://localhost` and `TRUST_PROXY=1` for that setup.
  Add HTTPS (and your public origin to `CORS_ORIGIN`) in front of it for a public deployment.

Data and secrets (P6 audit):
- `.dockerignore` keeps `.env`, `node_modules`, build output and the local JSON databases out of the
  build context, so no user, token or job data is baked into an image.
- Compose sets `CARBONROUTE_DB_FILE=/app/database/carbonroute.db.json` and
  `LOCAL_STORAGE_DIR=/app/storage/uploads`. Without them the compiled code would write the database to
  `/database` inside the container, outside the mounted volume, and lose it when the container is
  recreated.
- Docker is not installed on the development machine, so images have **not** been built or run
  locally. Since P7 the CI job `Docker images` builds both images on GitHub's runners, checks that
  no `.env` or local database is inside them, runs the backend in production mode with throwaway
  secrets behind the nginx frontend, and validates the compose file. Nothing is pushed to a registry.

## 5. Current hosted setup and prerequisites

- **Frontend**: GitHub Pages, deployed by `.github/workflows/deploy-pages.yml` **only on pushes to
  `main`** (the remediation work is on `fix/prototype-flaws` and has not been deployed). Built with
  `GITHUB_PAGES=true`. The base path follows the repository that builds it (`/CarbonRoute-AS/` here,
  from `GITHUB_REPOSITORY`; override with `PAGES_BASE_PATH`), fixed in P7. The backend URL comes from
  the repository variable `VITE_API_URL`; the build fails without it (P8). There is no default backend.
- **Backend**: Render (`https://carbonroute.onrender.com`). Before deploying the remediated backend:
  set `NODE_ENV=production`, a new `JWT_SECRET`, `ADMIN_PASSWORD` (if the database is new),
  `CORS_ORIGIN` with the Pages origin, `TRUST_PROXY=1` and `ELECTRICITY_MAPS_API_KEY` in Render's
  environment settings, never in the repository.
- **Persistence**: the JSON database lives on the service's disk. On a host with an ephemeral disk
  (Render without a persistent disk) users, jobs and decisions are lost on every deploy or restart;
  attach a persistent disk and point `CARBONROUTE_DB_FILE` at it.
- **Single instance only**: rate limits, the provider call budget and caches are in memory.
- **Result files** (`BENCHMARK_RESULTS_DIR`, `ML_RESULTS_DIR`) are not in the repository; the hosted
  Results page is empty unless they are copied to the server.

See [ENVIRONMENT.md](ENVIRONMENT.md) for every variable and
[DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md) for blockers, the credential-rotation plan and the
staging checklist.

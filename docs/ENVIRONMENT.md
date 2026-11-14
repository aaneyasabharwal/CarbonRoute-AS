# Environment variables

All configuration is read from environment variables. Locally they come from the repository-root
`.env` (git-ignored; start from `.env.example`). **Never commit real values.** Docker Compose reads the
same file through `env_file`. No secret has a default.

## Backend (`backend/`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `production` enables the secret checks below. |
| `PORT` | no | `5000` | HTTP port. |
| `JWT_SECRET` | **production** | random per process in development | HS256 signing key, at least 32 characters, never a value published in this repository. Changing it invalidates every token. The server refuses to start in production without a valid value. |
| `JWT_EXPIRES_IN` | no | `12h` | Token lifetime (shorter than before P8 because tokens are kept in browser localStorage). |
| `ADMIN_USERNAME`, `ADMIN_EMAIL` | no | `admin`, `admin@carbonroute.org` | Initial administrator. |
| `ADMIN_PASSWORD` | **production, first start** | none | Creates the initial admin only when the database has no users (12+ characters). Not used afterwards; rotate with `npm run admin:set-password`. |
| `CORS_ORIGIN` | **production** | local dev origins | Comma-separated browser origins allowed to call the API (no wildcard); also used for CSP `frame-ancestors`. |
| `TRUST_PROXY` | behind a proxy | empty | `1` behind one reverse proxy (Render, the Docker nginx) so rate limits see the client address. Leave empty otherwise (prevents address spoofing). |
| `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_IP_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MIN` | no | 10, 50, 15 | Login attempts per account / per address per window. |
| `RATE_LIMIT_JOBS_MAX`, `RATE_LIMIT_JOBS_WINDOW_MIN` | no | 30, 10 | Job actions per user per window. |
| `RATE_LIMIT_CARBON_MAX`, `RATE_LIMIT_CARBON_WINDOW_MIN` | no | 60, 60 | Live carbon-data requests per user per window. |
| `RATE_LIMIT_PUBLIC_MAX`, `RATE_LIMIT_PUBLIC_WINDOW_MIN` | no | 60, 10 | Public compute requests (`/scheduler/simulate`, `/cluster/health`) per address per window (P8). |
| `RATE_LIMIT_PASSWORD_MAX` | no | 5 | Password changes per user per login window (P8). |
| `ELECTRICITY_MAPS_API_KEY` | for live data | none | Electricity Maps v3 key. Without it, live scheduling and live carbon routes answer with an error (no synthetic substitute); demo mode still works. |
| `EM_MAX_CALLS_PER_HOUR`, `EM_MAX_CALLS_PER_DAY` | no | 120, 1500 | Server-wide provider call budget; beyond it live routes answer 429 `QUOTA_GUARD`. |
| `CARBONROUTE_DB_FILE` | no | `<repo>/database/carbonroute.db.json` | Main JSON database file; the scheduling store is `carbonroute.scheduling.db.json` next to it. Set it in containers (see DEPLOYMENT.md). |
| `STORAGE_TYPE` | no | `local` | `local` or `s3` for uploaded presentations/resources. |
| `LOCAL_STORAGE_DIR` | no | `backend/uploads` | Upload folder for `local` storage. |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_BUCKET_NAME`, `AWS_ENDPOINT`, `AWS_S3_FORCE_PATH_STYLE` | for `s3` | — | S3-compatible storage. |
| `BENCHMARK_RESULTS_DIR` | no | `../CarbonRoute-AS-data/benchmark-results` (next to the repository) | Folder the Results page reads benchmark runs from. |
| `ML_RESULTS_DIR` | no | `../CarbonRoute-AS-data/ml-results` | Folder the Results page reads model evaluations from. |

Scripts only: `NEW_ADMIN_PASSWORD` (for `npm run admin:set-password`), and `NEW_USER_USERNAME`, `NEW_USER_EMAIL`, `NEW_USER_PASSWORD`, `NEW_USER_ROLE` (for
`npm run user:create`). They are read from the environment and never
printed.

## Frontend (`frontend/`, build time)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | none. Without it: `http://localhost:5000` on localhost, otherwise the **same origin** (`/api`) | Backend base URL (with or without `/api`). **Required for the GitHub Pages build**, which fails without it, with a non-https URL, or with a retired backend (`carbonroute.onrender.com`). For Pages it comes from the repository *variable* `VITE_API_URL`. The Docker image sets `/api` (same origin through nginx). (P8) |
| `GITHUB_PAGES` | unset | `true` builds for GitHub Pages under `/<repository>/` (from `GITHUB_REPOSITORY`, default `CarbonRoute-AS`). |
| `PAGES_BASE_PATH` | unset | Overrides the Pages base path (e.g. `/` for a custom domain). |

There is no default remote backend (P8). Whatever backend `VITE_API_URL` names must list the frontend's
origin in its `CORS_ORIGIN`.

## FastAPI service (`fastapi_service/`, optional)

| Variable | Purpose |
|---|---|
| `CORS_ORIGIN` | Same comma-separated list; credentials are never combined with `*`. |

## Tests

The test suites set their own values (`backend/test/support/testEnv.ts`): blank secrets, temporary
database and result folders, generous rate limits. They never read the real `.env` values for secrets
and make no provider calls.

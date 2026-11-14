# CarbonRoute-AS handover (2026-11-14)

State of the project at handover, what was verified, and exactly what is left. Secrets are never
written here; only variable names.

## 1. Repository state

| Item | Value |
|---|---|
| Integration branch | `fix/prototype-flaws` @ `0911964` (all P8 PRs #16–#24 merged; CI 4/4 green) |
| P9 branch (open PR, not merged) | `task/p9-staging-readiness`, on top of `0911964`: three fixes, staging preparation and documentation (§3) |
| `main` | `80b411a`, untouched; nothing was ever merged or pushed to it |
| Old Render backend `carbonroute.onrender.com` | suspended (503), untouched, never resumed |
| Deployed services | **none**. GitHub Pages is disabled; no Render service was created |

Merged pull requests into `fix/prototype-flaws` (newest last): #14 P6 delivery, #15 P7 stabilisation,
#16 security, #21 Dashboard, #17 backend URL / Pages build, #18 job lifecycle, #19 exact deadline
instants, #20 research report, #24 Experiments page, #22 Account page, #23 documentation.

## 2. Verification results

| Gate | Result |
|---|---|
| Backend typecheck / build | pass / pass |
| Backend tests | **332 passed in 24 files**, of which **11 are expected failures (`it.fails`)** that keep removed invalid behaviour from returning; 321 assert current behaviour |
| Frontend typecheck / build | pass / pass |
| Frontend tests | **121 passed in 15 files** |
| GitHub Pages build | fails without `VITE_API_URL` (by design); passes with it |
| Python service tests | 5 passed |
| CI on `fix/prototype-flaws` @ `0911964` | 4/4 (Backend incl. collector-lock stress test, Frontend, Python, Docker build and smoke test) |
| Live API check against a local backend (one real Electricity Maps call) | 30/30 |
| Browser walk-through (production build, local API) | sign-in (admin and student), Dashboard, Prototype live and demo scheduling, dispatch, My Jobs, report, Results, Experiments, Account password change and account creation; all 16 pages render without console errors |
| Staging rehearsal (production mode, fresh clone, `render.yaml` commands) | staging checks 22/22; persistence after a real restart 4/4; bundle has no secrets (see STAGING.md §1) |

## 3. Defects fixed today (P9, branch `task/p9-staging-readiness`)

Each fix has a regression test that fails on the previous code.

| Commit | Defect |
|---|---|
| `5406966` | Since exact arrival instants, the first candidate window read `T+0:00 → T+2.990635:00` with `9.999999166666665h remaining`; labels now use h:mm (`T+0:59 → T+2:59`) and slack is rounded |
| `71d7eb1` | Opening the Prototype page scheduled a job at once: every visit stored a job the user never submitted and spent live provider calls; scheduling now runs only on "Evaluate" |
| `8b12c94` | A student who signed in saw "Admin Active" and upload buttons the backend then refused; the form said "Sign In as Admin" although every account signs in there. Non-admins now get their own pages |
| `623b75b` | `render.yaml` staging Blueprint (API + 1 GB disk, static frontend) and committed aggregate results for the staging Results page |
| `75cc184` | The documented Render build (`npm ci && npm run build`) fails under `NODE_ENV=production` (TypeScript is a dev dependency); fixed to `--include=dev`. Staging runbook and `scripts/staging-check.mjs` |

Earlier review fixes (merged in #17/#18): concurrent dispatches started several runs; older stored
runs received a new run's status; a git-ignored `.env` file could build the retired backend into the bundle.

## 4. Running locally

Requirements: Node.js 20 (24 works), npm; optional Python 3.12.

```bash
cp .env.example .env            # fill in values; see docs/ENVIRONMENT.md; never commit .env
cd backend && npm ci && npm run build && cd ..
cd frontend && npm ci && cd ..
cd backend && npm run dev       # API http://localhost:5000
cd frontend && npm run dev      # app http://localhost:5173
```

Create an account: `cd backend && NEW_USER_USERNAME=... NEW_USER_EMAIL=... NEW_USER_PASSWORD=... npm run user:create`
(add `NEW_USER_ROLE=admin` for an administrator). Without `JWT_SECRET` in `.env`, development uses a
random secret per process, so sessions end when the API restarts. Tests: `npm test` in `backend/` and
`frontend/`; typecheck `npm run typecheck` (backend) / `npx tsc --noEmit` (frontend).

## 5. Staging (prepared, not deployed)

Everything is in [STAGING.md](STAGING.md): hosting comparison, owner steps, verification commands,
logs, restarts, persistence checks and rollback. Summary:

- **Owner choice: Render Free, no persistence** ($0): API and static site from `fix/prototype-flaws`,
  created from `render.yaml`. Accounts and jobs are lost on every deploy, restart and 15-minute idle
  spin-down; the admin is re-created from `ADMIN_PASSWORD` (keep it set). Rehearsed: staging checks
  22/22; after a clean restart the admin signs in and earlier data is gone, as expected. Persistent
  option (about $7.25/month with a 1 GB disk) remains documented.
- **URLs** (after creation; Render may add a suffix): API `https://carbonroute-staging-api.onrender.com`,
  frontend `https://carbonroute-staging-web.onrender.com`.
- **Environment (names only)**: API `NODE_ENV`, `NODE_VERSION`, `JWT_SECRET` (generated by Render),
  `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (keep set on the free plan), `CORS_ORIGIN`, `TRUST_PROXY`,
  `CARBONROUTE_DB_FILE`, `STORAGE_TYPE`, `LOCAL_STORAGE_DIR`, `BENCHMARK_RESULTS_DIR`,
  `ML_RESULTS_DIR`, optional `ELECTRICITY_MAPS_API_KEY`, `EM_MAX_CALLS_PER_HOUR`,
  `EM_MAX_CALLS_PER_DAY`; static site `VITE_API_URL`. Full reference: [ENVIRONMENT.md](ENVIRONMENT.md).
- **Verify**: `node scripts/staging-check.mjs ...` (STAGING.md §4); on the free plan skip `--verify-persisted`.

## 6. Research data and collector

| Item | State at 2026-11-14 06:57 UTC |
|---|---|
| Collector | pid **3304**, holding lock port 26554, approved 25-run plan, 19 runs done (last 06:07 UTC), 0 failed calls; stops by itself after run 25 (about 12:07 UTC) |
| Data | `../CarbonRoute-AS-data/em-collection/collection-2026-11-13.jsonl` (120 lines, sha256 `397ebd6a…`, complete) and `collection-2026-11-14.jsonl` (70 lines, growing); 190 records, all parseable |
| Backups | `../CarbonRoute-AS-data/backups/em-collection-2026-11-13-complete` (checksum matches), `backups/em-collection-20261113T1952Z` |
| Results | `../CarbonRoute-AS-data/benchmark-results`, `ml-results`, `reports`; latest copies in `results/published/` |
| Findings | 0.40 days of data: no evidence of a carbon difference for CarbonRoute vs Immediate at runtime CV 0.2 (−7.21 [−17.39, +0.40] gCO2eq/kWh); simulated violations Greedy 23.4 % vs CarbonRoute 0.9 %; ML insufficient data, **no model trained** |

Do not start a second collector, and do not edit, truncate or regenerate the JSONL files. Restarting
for the 7-day plan (168 runs) needs the owner's approval: see [COLLECTOR.md](COLLECTOR.md).

## 7. Remaining limitations and blockers

- **Owner decisions**: merge the P9 PR; create the free staging services from `render.yaml` (Render account, no cost);
  approve the next collection period; later, merge to `main` and enable Pages.
- Under one day of real data: no result is statistically conclusive; no ML model exists.
- Storage is JSON files in one process (single instance only); sessions are bearer tokens in
  `localStorage` (12 h lifetime, CSP); no real Kubernetes execution or energy measurement.
- The Electricity Maps trial key expires around 26–27 Nov 2026; live scheduling then fails clearly and
  demo mode keeps working.

## 8. Before merging into `main`

1. Merge the P9 PR into `fix/prototype-flaws`; CI green.
2. Deploy staging (STAGING.md) and pass `scripts/staging-check.mjs` including `--verify-persisted`.
3. Decide the production backend (a new service with new secrets and a persistent disk; never the
   old service) and record the old service's settings (DEPLOYMENT_READINESS.md §4).
4. Set the repository variable `VITE_API_URL` to the production API; add
   `https://aaneyasabharwal.github.io` to that API's `CORS_ORIGIN`.
5. Open a PR `fix/prototype-flaws` → `main`, review, merge with approval; enable Pages
   (Source: GitHub Actions); the Pages workflow then deploys from `main`.
6. Re-run the staging checks against production; keep the old service suspended, then delete it only
   after its settings are recorded.

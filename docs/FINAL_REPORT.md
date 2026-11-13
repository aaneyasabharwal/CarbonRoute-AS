# Final verification, defect and limitations report (P6)

Date: 2026-11-13 (UTC). Branch `task/p6-final-delivery` from `fix/prototype-flaws` at `1a89f6f`
(remediation PRs #6–#13 merged). `main` has not been changed or deployed by the remediation.
This report states what was verified, by what evidence, and what is not done. Implemented does not
mean production-ready.

## 1. Verification performed

| Check | Result |
|---|---|
| Backend `npm run typecheck` (source + tests) | pass |
| Backend `npm test` (Vitest) | **278 passed**, 19 files (legacy tests that encoded the removed risk model run as expected failures with corrected versions alongside) |
| Backend `npm run build` | pass |
| Frontend `npm run typecheck` | pass |
| Frontend `npm test` (Vitest + Testing Library) | **92 passed**, 9 files |
| Frontend `npm run build` and GitHub Pages build (`GITHUB_PAGES=true`) | pass (bundle-size warning only) |
| Python `unittest` (FastAPI CORS settings) | 5 passed (Python 3.12) |
| End-to-end API check on a running backend with a temporary database (scratch script, not committed) | **30/30**: CORS allow-list and rejection of unknown origins, CSP header, 401 without token on jobs and live data, public demo data, login / wrong password, **live** scheduling with provenance (real data, raw SHA-256), declared runtime CV applied, explanation, 5 policies + 2 unavailable, no invented forecast uncertainty, job details, 404 for another user's job, observations before window end are `PENDING` with none invented, oracle unavailable without coverage, HTML report download, simulated dispatch labelled, cancel, impossible deadline stored as `INFEASIBLE`, results endpoints (cluster intervals present, ML `insufficient-data` without scores), logout and token revocation, no password or API key in server output. One provider call was used. |
| Reproducible demo (`npm run demo`) on collected data | runs end to end; two runs give identical summaries (also a unit test) |
| CI | see the PR's checks |

Not verified: Docker image builds (Docker is not installed on this machine; configuration reviewed
by reading), a real Kubernetes execution (no cluster), the hosted deployment of this code (not
deployed; requires approval), browsers other than the test environment's DOM.

## 2. Defects found by the P6 audit and fixed in this PR

| # | Defect | Fix | Evidence |
|---|---|---|---|
| P6-1 | The backend Docker image copied `database/`, including the local JSON databases (user hashes, revoked tokens, jobs), into the image: there was no `.dockerignore`. | `.dockerignore` excludes `.env`, databases, `node_modules`, build output, local uploads. | Reviewed; Docker not available to build. |
| P6-2 | In the container the database path resolved to `/database`, outside the mounted volume: data lost on container recreation. Uploads went to `/app/uploads`, also unmounted. | Compose sets `CARBONROUTE_DB_FILE` and `LOCAL_STORAGE_DIR` to the mounted folders. | Path traced from `models/db.ts` and `config/index.ts`. |
| P6-3 | The Docker frontend called `http://localhost:5000` directly from origin `http://localhost`, which the CORS allow-list rejects. | Frontend image built with `VITE_API_URL=/api` (same origin through nginx); compose sets `CORS_ORIGIN` and `TRUST_PROXY=1`. | Reviewed. |
| P6-4 | The Prototype page never sent a runtime CV: every decision made from the UI used a deterministic runtime, so the risk constraint could never bind there. | Runtime-variability selector; value sent as `runtimeCv`. | Frontend regression test. |
| P6-5 | Benchmark intervals resampled individual synthetic workloads, which share snapshots and realized hours, giving intervals that were too narrow (same issue fixed for ML in PR #13). | Paired difference now also reported with a cluster bootstrap over forecast snapshots (`diffVsImmediateClusterCI`), used by reports, the Results page and the demo; older files are labelled "workload-level interval, optimistic". | Backend tests (one snapshot ⇒ no interval; cluster counts), frontend tests. Example: CarbonRoute cv 0.2, workload-level [−14.79, −5.96] vs cluster [−23.66, −1.31]. |
| P6-6 | Website pages claimed features that do not exist or were removed: "seamless fallback to calibrated traces" (live failures return errors), "calibrated" / "guaranteed" deadline risk, the old σ(t) horizon-dispersion and erfc risk formulas, a local sandbox that "executes" workloads (nothing runs), dispatch "when the scheduled time arrives" (it is manual), "verified empirical carbon savings", Brier/ECE results. | Text corrected on Home, How it works, Architecture, System design, Project, Demonstrations and Prototype pages to match the code. | Diff; frontend tests and build. |
| P6-7 | README, ARCHITECTURE.md, the `/scheduler/simulate` API description and the old demo walkthrough described the September prototype. | Rewritten / marked superseded; new ENVIRONMENT, DEMO, COLLECTOR, RESEARCH_SUMMARY docs. | — |
| P6-8 | `tests/prototype_vertical_slice_test.cjs` failed 7 of 12 checks because it tests the removed risk model. | Retired; its scope is covered by the Vitest suites (engine, workflow, k8s). | Ran it before removal: 5 passed, 7 failed. |
| P6-9 | `fastapi_service/main.py` still implements the removed risk model and could be mistaken for part of the system. | Marked legacy / not used in its header and in the docs. | — |

## 3. Open defects and risks (not fixed here)

| Severity | Item | Notes |
|---|---|---|
| **High (live)** | The hosted backend `https://carbonroute.onrender.com` runs **pre-remediation code**: it reflected an arbitrary `Origin` (`https://evil.example`) with `Access-Control-Allow-Credentials: true`, and none of the remediated routes exist (`/api/jobs`, `/api/results/*` answer 404). Earlier versions also had a committed default admin password and JWT secrets. | Observed 2026-11-13 19:28 UTC with `GET /api/health`. Fixing requires deploying the remediated backend with new secrets (DEPLOYMENT.md §5); not done without approval. The hosted Pages frontend (from `main`) is also the old version. |
| Medium | GitHub Pages base path is `/CarbonRoute/`; on this fork (`CarbonRoute-AS`) a Pages deployment would serve broken asset paths. | Depends on which repository hosts Pages. |
| Medium | Session token in `localStorage` (exposed to any XSS). | Roadmap M14.7 (httpOnly cookie). CSP reduces but does not remove the risk. |
| Medium | JSON-file storage, single process; rate limits, provider budget and caches in memory. | Not suitable for multiple instances or concurrent writers. Ephemeral disks lose data. |
| Medium | Older databases may contain orphan "pending" jobs created before the P4 fix. | Cosmetic in the job list. |
| Low | Engine ranks on hourly-slot averages and floors the deadline to whole forecast hours, so a window ending before the wall-clock deadline can get 50 % risk (seen in the demo). | Conservative; roadmap M3.5. |
| Low | The bundle is larger than Vite's warning size. | Performance only. |

## 4. Limitations (by design or data)

- **Data**: 7 hourly collection runs (13:32–19:32 UTC, 2026-11-13), 5 zones, 0 failures at the time of
  writing. Not 7 days. Results cover one afternoon. Collection runs until about 2026-11-14 13:32 UTC
  and must then be restarted ([COLLECTOR.md](COLLECTOR.md)); the trial key expires ~26–27 Nov.
- **Ground truth**: about 39 % of realized values are provider estimates (all of GB).
- **Deadline risk**: from a declared runtime CV; no recorded runtimes; not calibrated (no Brier/ECE).
- **Forecast uncertainty**: none from the provider; empirical error bands need ≥ 30 pairs per lead
  bucket; not used in decisions.
- **Energy and emissions**: assumed model; no realized emissions anywhere.
- **Execution**: simulated without a cluster; manual dispatch; no queue, capacity or multi-job EDF.
- **Policies**: cost-aware unavailable (no price provider); oracle offline only.
- **ML**: `insufficient-data`; no trained model; anomaly flags are unsupervised screening only.
- **Benchmark**: synthetic workloads; scored subsets differ by policy; cluster intervals ignore
  correlation between neighbouring snapshots.

## 5. Completion status

**1. Fully implemented and verified (tests + end-to-end check)**
Credential handling and rotation tooling; JWT with revocation and password-change cut-off; job
ownership and audited admin access; rate limits and provider call budget; CORS allow-list and CSP;
storage path allow-list; safe Kubernetes manifest/kubectl invocation; Electricity Maps client with
provenance and quality labels; risk-constrained engine with five policies, explicit infeasible
results and explanations; observation collection and forecast-vs-realized evaluation; reports;
offline oracle; Results page; collector, coverage, benchmark, ML pipeline gating and demo scripts;
CI for backend, frontend and Python.

**2. Implemented but not fully validated**
Policy comparison on real data (5–6 h of data; no conclusion possible); forecast-accuracy figures
(21 pairs per zone); the ML pipeline on real data (only the insufficient-data path has run on real
data; the evaluated paths are tested on synthetic fixtures); Kubernetes submission (no cluster
available); Docker/compose configuration (not built); deadline-risk model (not calibrated).

**3. Partially implemented**
Deployment (configuration documented, hosted services still run the old code); risk calibration
(formula and declared CV only); forecast uncertainty (error bands gated on data); execution
(simulated path complete, real path untested, no scheduled start).

**4. Not completed**
Seven days of collected data; trained/promoted forecast-error model; any statistically supported
carbon-saving result; measured energy and realized emissions; cost-aware scheduling; multi-job
queueing/capacity; PostgreSQL or other durable multi-instance storage; httpOnly-cookie sessions;
deployment of the remediated system; merge of `fix/prototype-flaws` into `main`.

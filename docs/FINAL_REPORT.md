# Final verification, defect and limitations report (P6)

Date: 2026-11-13 (UTC). Branch `task/p6-final-delivery` from `fix/prototype-flaws` at `1a89f6f`
(remediation PRs #6–#13 merged). `main` has not been changed or deployed by the remediation.
This report states what was verified, by what evidence, and what is not done. Implemented does not
mean production-ready.

> **P8 (2026-11-13/14): §8 is the current status and supersedes §5.** It describes
> `fix/prototype-flaws` with PRs #16–#22 merged; until they are merged, those changes exist only on
> their branches.

> **P7 review (2026-11-13).** Every claim below was re-checked against its evidence. Corrections:
> the backend test count includes 11 legacy `it.fails` tests (they pass because the old behaviour is
> still asserted to fail); Kubernetes submission is verified by unit tests only; the live
> observation path was exercised only up to `PENDING` through the API (the `COMPLETE` path is
> verified with fixtures and with replayed real history); local credentials were rotated, hosted
> ones were **not**; the Pages base path is fixed in P7; Docker images are now built in CI (not
> locally). Deployment status and blockers: [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md).
> Final P7 test numbers are in §6.

## 1. Verification performed

| Check | Result |
|---|---|
| Backend `npm run typecheck` (source + tests) | pass |
| Backend `npm test` (Vitest) | **278 passed**, 19 files. 11 of them are legacy `it.fails` tests (old behaviour that must keep failing, e.g. the removed risk model), with corrected tests alongside; 267 assert current behaviour. |
| Backend `npm run build` | pass |
| Frontend `npm run typecheck` | pass |
| Frontend `npm test` (Vitest + Testing Library) | **92 passed**, 9 files |
| Frontend `npm run build` and GitHub Pages build (`GITHUB_PAGES=true`) | pass (bundle-size warning only) |
| Python `unittest` (FastAPI CORS settings) | 5 passed (Python 3.12) |
| End-to-end API check on a running backend with a temporary database (scratch script, not committed) | **30/30**: CORS allow-list and rejection of unknown origins, CSP header, 401 without token on jobs and live data, public demo data, login / wrong password, **live** scheduling with provenance (real data, raw SHA-256), declared runtime CV applied, explanation, 5 policies + 2 unavailable, no invented forecast uncertainty, job details, 404 for another user's job, observations before window end are `PENDING` with none invented, oracle unavailable without coverage, HTML report download, simulated dispatch labelled, cancel, impossible deadline stored as `INFEASIBLE`, results endpoints (cluster intervals present, ML `insufficient-data` without scores), logout and token revocation, no password or API key in server output. One provider call was used. |
| Reproducible demo (`npm run demo`) on collected data | runs end to end; two runs give identical summaries (also a unit test) |
| CI | PR #14 head `ddb3939`: 6/6 checks green (backend, frontend, Python; push and pull_request). Base after merge `8729f43`: 3/3 green. |

Not verified: Docker image builds at P6 (Docker is not installed on this machine; configuration
reviewed by reading; P7 adds a CI job that builds and smoke-tests the images), a real Kubernetes execution (no cluster), the hosted deployment of this code (not
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
| ~~High (live)~~ **contained**, replacement pending | The old hosted backend `https://carbonroute.onrender.com` ran **pre-remediation code**: it reflected an arbitrary `Origin` (`https://evil.example`) with `Access-Control-Allow-Credentials: true` (observed 2026-11-13 19:28 and 20:00 UTC), remediated routes answered 404, and that code version used the committed default admin password and JWT secrets. | **Suspended manually by the service owner** (not deleted). **Externally verified 2026-11-13 20:35 UTC:** `/`, `/api/health`, `/api/auth/login` (GET and POST) and `/api/presentations` return 503 with `x-render-routing: suspend-by-user` and no CORS headers. The old secrets are still in git history and must not be reused. The secured replacement is not deployed (DEPLOYMENT_READINESS.md). The public Pages site (from `main`) is the old version and now has no working backend. |
| ~~Medium~~ fixed in P7 | GitHub Pages base path was hard-coded to `/CarbonRoute/`; on this repository (`CarbonRoute-AS`) every asset and route would break. | Now derived from the repository name; production build served under `/CarbonRoute-AS/` and checked in a browser (P7). |
| **Medium (deployment blocker, not fixed)** | `.github/workflows/deploy-pages.yml` does not set `VITE_API_URL`, so a Pages build falls back to the hard-coded `https://carbonroute.onrender.com` (`frontend/src/services/api.ts`), the suspended backend. | Must be fixed before any merge to `main` (DEPLOYMENT_READINESS.md B7). |
| ~~Medium~~ fixed in P7 | Collector lock. The first P7 lock let collectors that started together while a stale lock existed both start (3 of 6 processes), and the sprint wrapper ignored it. Its replacement (c204f90, heartbeat leases) was still unsafe under adversarial review: a live collector whose lease looked stale (sleep, stalled loop, clock jump) kept appending after another collector took over (reproduced: 4 records), and its tidy-up could delete a newer owner's lock (reproduced). | Now an operating-system-enforced lock (exclusive listening socket on 127.0.0.1, port derived from the folder), freed by the OS on any exit including SIGKILL; no files, leases, clocks or pids; every append fenced by a synchronous ownership check; every entry point goes through it. Multi-process regression tests and an adversarial stress test with an oracle self-check, also in CI. Limits (same machine only) in COLLECTOR.md. |
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
Credential handling and rotation tooling (local credentials rotated; **hosted credentials not
rotated**); JWT with revocation and password-change cut-off; job
ownership and audited admin access; rate limits and provider call budget; CORS allow-list and CSP;
storage path allow-list; Electricity Maps client with provenance and quality labels (live: 70
collector calls, 0 failures, plus one live scheduling call); risk-constrained engine with five policies, explicit infeasible
results and explanations; forecast-vs-realized evaluation and reports (observation collection:
live API path verified to `PENDING`, `COMPLETE` path with fixtures and replayed real history);
offline oracle; Results page; collector, coverage, benchmark, ML pipeline gating and demo scripts;
CI for backend, frontend and Python.

**2. Implemented but not fully validated**
Policy comparison on real data (5–6 h of data; no conclusion possible); forecast-accuracy figures
(21 pairs per zone); the ML pipeline on real data (only the insufficient-data path has run on real
data; the evaluated paths are tested on synthetic fixtures); Kubernetes submission (no cluster
available; manifest construction and argument-array invocation are unit-tested only);
Docker/compose configuration (built and smoke-tested in CI from P7, never run locally);
deadline-risk model (not calibrated).

**3. Partially implemented**
Deployment (configuration documented; old hosted backend suspended and verified unavailable;
secured replacement not deployed; Pages `VITE_API_URL` not configured); risk calibration
(formula and declared CV only); forecast uncertainty (error bands gated on data); execution
(simulated path complete, real path untested, no scheduled start).

**4. Not completed**
Seven days of collected data; trained/promoted forecast-error model; any statistically supported
carbon-saving result; measured energy and realized emissions; cost-aware scheduling; multi-job
queueing/capacity; PostgreSQL or other durable multi-instance storage; httpOnly-cookie sessions;
deployment of the remediated system; merge of `fix/prototype-flaws` into `main`.

## 6. P7 stabilisation (on top of `8729f43`)

- GitHub Pages base path derived from the repository (`/CarbonRoute-AS/`); two `href="/admin"` links
  that ignored the base path replaced by router links. Pages build served under `/CarbonRoute-AS/`
  with a Pages-like 404 fallback and checked in a browser: assets load, deep links (`/how-it-works`,
  `/resources`) render, all internal links carry the base path.
- Collector folder lock (no second collector can write to the same folder; stale locks replaced; data
  files untouched), tested. Verified backup of the collected data.
- CI job `Docker images`: builds both images, proves decoy `.env`/database files stay out, runs the
  backend in production mode behind nginx, refuses to start without `JWT_SECRET`, validates compose.
- Deployment readiness report with blockers, rotation plan, staging checklist:
  [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md).
- Verification on the P7 tree: backend typecheck, **280 tests** (11 `it.fails`), build; frontend
  typecheck, **97 tests**, build and Pages build (assets under `/CarbonRoute-AS/`); Python 5 tests. The
  30-check end-to-end API run was not repeated for P7 (no backend request path changed). Docker job:
  see the P7 PR's CI.
- **Containment (2026-11-13):** the old Render service was suspended manually by its owner and
  verified unavailable from outside at 20:35 UTC (503, `x-render-routing: suspend-by-user`, no CORS
  headers). Nothing else on Render was changed; no service or disk was created; no credential was
  rotated. Open deployment blockers, including the unconfigured Pages `VITE_API_URL`, are in
  [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md).

## 7. P8 completion sprint (branches `task/p8-*`, PRs #16–#22, not merged)

Defects found and fixed, each with a regression test that fails on the old code:

| Id | Defect | PR |
|---|---|---|
| S1 | Login response time revealed whether a username exists | #16 |
| S2 | Public `/cluster/health` returned `kubectl` output (control-plane address) and spawned `kubectl` on every request | #16 |
| S3 | Public compute endpoints were not rate limited | #16 |
| S4 | Unexpected errors returned exception text (paths, internals) to clients | #16 |
| S7/S8 | No password change (token invalidation unreachable); no account management except the CLI | #16 (API), #22 (UI) |
| N1 | Every signed-in user saw the Admin link; the mobile menu had no account links | #22 |
| B7 | The frontend silently defaulted to the suspended old backend; Pages workflow set no API URL | #17 |
| L1 | Execution status lived only in memory (restart showed completed jobs as scheduled) | #18 |
| L2 | A job could be dispatched repeatedly | #18 |
| L3 | A job without a recommended window could be dispatched | #18 |
| E1 | Deadline risk floored the deadline (over-conservative) and measured the arrival slot from the start of its hour (under-estimated an immediate start); the two errors partly masked each other | #19 |
| R1 | No reproducible research report; interpretation of intervals was manual | #20 |
| D1 | The Dashboard was a placeholder preview with no data | #21 |
| T1 | A collector test failed on Windows checkouts (CRLF) | #16, #18, #19, #20 |
| L4 | (review) Concurrent dispatch requests started several runs (the check ran before an asynchronous cluster probe); an older run stored without a status received the new run's status updates | #18 |
| B7b | (review) The build check ignored `VITE_API_URL` from git-ignored `frontend/.env*` files, so a retired backend could still be built in | #17 |

Verification of the combined tree (all code branches merged locally, including the review fixes,
2026-11-14 06:30 UTC): backend typecheck, **331 tests (11 `it.fails`)**, build; frontend typecheck,
**117 tests**, build; Pages build
with a URL passes and without one fails (by design); Python 5 tests; live end-to-end API check
**30/30**. Each PR is green in CI (4/4 jobs: Backend incl. lock stress test, Frontend, Python, Docker).
Details: [TESTING.md](TESTING.md), [SPRINT_PROGRESS.md](SPRINT_PROGRESS.md).

Real data at the end of the sprint's analysis (23:48 UTC): 12 collection runs, 120 calls, 0 failures,
0.40 days; benchmark on 60 snapshots, 170 realized values (61.2 % measured); ML insufficient-data
(140 / 9 / 21 rows). See RESEARCH_SUMMARY.md.

## 8. Completion status (after PRs #16–#22)

Labels: *CI* = automated tests run in CI; *real data* = exercised on collected Electricity Maps data;
*local* = verified on this machine only. Nothing is *deployed*.

**1. Fully implemented and verified**
- Authentication and sessions: bcrypt passwords, HS256 JWT (12 h) with revocation, password change
  invalidating older tokens, constant-cost login, rate limits, admin-only account creation (CI).
- Authorisation: job ownership (404 for others), audited administrator access, admin-only content and
  account routes (CI).
- Input/output hardening: CORS allow-list, CSP, 1 MB JSON limit, generic 500s with references, storage
  allow-list, Kubernetes manifest/argument safety, cluster status without internals (CI).
- Provider integration: Electricity Maps client with provenance, quality labels, horizons, caching and
  call budget (CI; real data: 120 collector calls, live scheduling in the end-to-end check).
- Scheduling engine: five policies on identical inputs, exact-instant deadline risk, explicit
  infeasible results, explanations, oracle offline only (CI; real data via replay and demo).
- Job lifecycle: submit/validate/persist/schedule/explain/view/cancel/dispatch-once, persisted
  execution status with honest 'interrupted', reports (CI; local end-to-end 30/30).
- Experiments: replay benchmark with snapshot-cluster intervals, forecast accuracy, reproducible demo,
  research report with guardrails (CI; real data).
- Collector: OS-enforced lock, fenced appends, all entry points (CI incl. multi-process stress; running
  on real data).
- Frontend: Dashboard, Prototype, My Jobs, Results, Account against real API shapes with loading,
  empty, error and sign-in states; authentication-aware navigation (CI).
- CI: backend, frontend, Python, Docker image build and smoke test, lock stress test.

**2. Implemented but incompletely validated**
- Policy comparison and forecast accuracy on real data: 0.40 days, not conclusive (report banner).
- ML pipeline on real data: only the insufficient-data path has run on real data; evaluation and
  promotion paths are tested on synthetic fixtures.
- Kubernetes submission: unit-tested (manifest, argument arrays, cancellation race); never run against
  a real cluster.
- Docker images: built and smoke-tested in CI only; never run locally.
- Deadline-risk model: mathematically tested; the runtime CV is declared, not calibrated.

**3. Partially implemented**
- Deployment: configuration, readiness report, rotation plan and staging checklist exist; the old
  backend is suspended; no new service exists (needs approval and possibly cost); Pages needs the
  repository variable `VITE_API_URL`.
- Forecast uncertainty: empirical error bands exist for one lead bucket per zone; not used in decisions.
- Execution: simulated path complete and persisted; real execution untested; no scheduled start.

**4. Not implemented**
- Seven days of collected data; a trained or promoted model.
- Measured energy and realized emissions; cost-aware scheduling (no price data).
- Multi-job queueing/capacity; resource utilisation metrics.
- Durable multi-instance storage (PostgreSQL); httpOnly-cookie sessions.
- Any deployment of the remediated system; merge to `main`.

# Testing strategy and quality gates

How CarbonRoute is tested, what each suite covers, and the current results. Counts are for
`fix/prototype-flaws` `task/p9-staging-readiness` (P8 PRs #16–#24 merged plus the P9 fixes; checked locally,
2026-11-14 07:30 UTC); each PR is also green in CI on its own.

## Principles

- **No provider calls and no secrets in tests.** Electricity Maps responses are recorded or hand-written
  fixtures in the provider's shape; `test/support/testEnv.ts` blanks secrets and uses temporary database,
  result and collection folders. Frontend tests block the network (`fetch` rejects) and stub the API
  with hand-written responses in the backend's shape.
- **Real code paths.** API tests drive the Express app through supertest (authentication, ownership,
  rate limits, CORS and CSP included). Multi-process behaviour (collector lock, wrapper invocation,
  crashes, SIGKILL, frozen processes) is tested with real child processes.
- **Every fixed defect has a regression test** that fails on the old code (P0–P8).
- **Expected failures are reported, not hidden.** Legacy tests that assert behaviour which must keep
  failing (for example the removed risk model) use `it.fails`; they are counted separately below.
- **Synthetic data is labelled** in test names and never reported as results.

## Suites

| Area | Files | What is verified |
|---|---|---|
| Security | `backend/test/security/*` | credentials and rotation, JWT (algorithm, expiry, revocation, password-change cut-off), ownership/IDOR (404), admin audit, path traversal, Kubernetes injection, rate limits, quota protection, CORS, CSP, login timing, password change, admin accounts, error leakage, public limits |
| Scheduling engine | `backend/test/scheduling/*` | candidate windows, deadline risk formula, five policies on identical inputs, infeasible results, oracle offline only, exact deadline/arrival instants |
| Workflow and lifecycle | `backend/test/workflow/*`, `backend/test/features/*` | scheduling workflow with stored snapshots and decisions, observations, reports, cancellation race, full job lifecycle with persisted execution status and restart, API features |
| Carbon data | `backend/test/carbon/*` | Electricity Maps client (zones, horizons, quality labels, caching, call budget, errors), coverage reporting |
| Evaluation and experiments | `backend/test/evaluation/*`, `backend/test/benchmark/*` | time weighting, forecast error metrics, replay benchmark reproducibility, snapshot-cluster intervals, demo, research report guardrails |
| Machine learning | `backend/test/ml/*` | leakage checks, chronological splits with gaps, baselines, ridge candidate, pre-registered promotion rule, insufficient-data gating |
| Collector | `backend/test/collector/*` | OS-enforced lock: simultaneous starts (8 processes), stale/empty/legacy lock files, SIGKILL, crash, frozen holder, fenced appends, every entry point |
| Isolation | `backend/test/isolation/*` | the app under test writes only to a temporary database and upload folder (secrets are blanked by `testEnv.ts`) |
| Legacy | `backend/test/legacy/*` | ported original scripts; 11 `it.fails` keep the invalid old behaviour from returning |
| Frontend pages | `frontend/test/pages/*`, `frontend/test/app/*` | every route renders; Prototype, Jobs, Results, Dashboard, Account against stubbed backend responses; loading, empty, error and sign-in states; no invented numbers |
| Frontend components and config | `frontend/test/components/*`, `frontend/test/config/*`, `frontend/test/context/*`, `frontend/test/services/*` | data-quality badges, model evaluation display, Pages base path, backend URL rules (no retired backend), auth context, API client |
| Python | `fastapi_service/tests` | CORS settings of the legacy FastAPI service |

## Quality gates

| Gate | Where | Result (combined tree, 2026-11-13) |
|---|---|---|
| Backend typecheck (source + tests) | local, CI | pass |
| Backend tests | local, CI | **332 passed in 24 files, of which 11 are `it.fails`** (321 assert current behaviour) |
| Backend build | local, CI | pass |
| Frontend typecheck | local, CI | pass |
| Frontend tests | local, CI | **121 passed in 15 files** |
| Frontend build; GitHub Pages build | local, CI | pass; a Pages build **without** `VITE_API_URL`, or any build whose `frontend/.env*` names the retired backend, fails by design |
| Python tests | local, CI | 5 passed |
| Docker images: build, no `.env`/database inside, backend in production mode behind nginx, refuses to start without `JWT_SECRET`, compose valid | CI only (Docker not installed locally) | pass |
| Collector-lock stress test + oracle self-check | CI (25 rounds × 8 processes); locally 150 rounds × 10 processes | 0 violations; broken lock detected |
| Staging check `scripts/staging-check.mjs` (22 checks + persistence after restart) | rehearsal of the Render setup in production mode; run it against real staging (docs/STAGING.md) | **22/22, 4/4** |
| Live end-to-end API check (30 checks: auth, CORS, CSP, ownership, live scheduling with provenance, explanation, observations, report, simulated dispatch, results, logout, no secrets in logs) | local only (one real provider call; script outside the repository because it creates accounts with generated passwords) | **30/30** |

## Not covered

- Real Kubernetes execution (no cluster available); manifests and `kubectl` invocation are unit-tested.
- A deployed environment (nothing is deployed).
- Browsers other than the jsdom test environment (manual checks only).
- Load and performance testing beyond the scheduler overhead measurement in `npm run report`.

# CarbonRoute architecture (as implemented, November 2026)

This describes the code in this repository, not a target design. Earlier versions of this file
described components that do not exist (calibration engine, Brier/ECE scoring, S3-immutable
deliverables, `POST /api/v1/schedule`); they were removed in the P6 audit.

## Components

```
                 Browser (React + Vite SPA, frontend/)
                   |  HTTPS, JSON, Bearer token
                   v
  +-------------------------------- backend/ (Node 20, Express, TypeScript) --------------------------------+
  | routes/api.ts  -> middleware: helmet/CSP, CORS allow-list, rate limits, JWT auth, job ownership          |
  |                                                                                                          |
  |  controllers/prototypeController   jobs: submit, schedule, dispatch, cancel, observations, report, oracle |
  |  controllers/schedulerController   /scheduler/simulate (feasibility demo, same engine)                   |
  |  controllers/resultsController     /results/benchmarks, /results/ml (read result files)                  |
  |  controllers/auth|presentation|resource|team|roadmap|storage   project website content                    |
  |                                                                                                          |
  |  services/schedulingWorkflow  validate -> forecast -> engine -> explanation -> store decision            |
  |  services/schedulerService    candidate windows, 5 policies, runtime-only deadline risk                  |
  |  services/uncertaintyService  P(miss) = 1 - Phi((D - t - d) / (cv d))                                    |
  |  services/explain             structured explanation of every decision                                   |
  |  services/energyModel         ASSUMED energy (0.125 kW per vCPU)                                         |
  |  services/carbonService       live provider (Electricity Maps) | demo provider (synthetic, labelled)     |
  |  carbon/electricityMaps       v3 client: zone validation, caching, call budget, provenance, SHA-256      |
  |  services/k8sConnector        kubectl apply (JSON manifest, argument arrays) or simulated execution      |
  |  services/reportService       JSON / HTML report of decision, observations and evaluation                |
  |  evaluation/                  time weighting, forecast evaluation, offline oracle, statistics            |
  |  benchmark/, ml/              offline experiments on collected data (scripts, not request handlers)      |
  |  models/db.ts                 JSON database: users, revoked tokens, audit log, website content           |
  |  models/schedulingStore.ts    JSON store: jobs, forecast snapshots, decisions, executions, observations  |
  +----------------------------------------------------------------------------------------------------------+
        |                                   |                                       |
        v                                   v                                       v
  Electricity Maps API v3        kubectl / Kubernetes cluster           ../CarbonRoute-AS-data/ (outside repo)
  (forecast, history, latest,    (optional; Minikube or any)            em-collection/*.jsonl, benchmark-results/,
   power breakdown, zones)                                              ml-results/, demo-runs/
```

Other folders: `fastapi_service/` is a **legacy** Python prototype (not used; still implements the
removed risk model); `scheduler/` and `simulator/` contain early specification stubs; `docker/` holds
the container build; `storage/uploads/presentations/` holds published presentation PDFs.

## Data flow: scheduling one job (`POST /api/schedule`)

1. **Authentication and limits.** JWT verified (signature, expiry, revocation list, password-change
   cut-off); per-user job-action rate limit.
2. **Validation** (`schedulingWorkflow.validate`, `workloadSpec`): duration, CPU, memory, risk
   tolerance τ ∈ (0, 1), optional runtime CV ∈ [0, 1], ISO-8601 deadline/arrival **with a time zone**,
   image/command checks.
3. **Forecast** (live): `ElectricityMapsClient.getForecast` for the smallest horizon (6/24/48/72 h)
   covering the deadline. The call is budgeted; the response is stored as a **forecast snapshot**
   (zone, issue/fetch time, horizon, emission-factor type, endpoint, SHA-256 of the raw body). If the
   provider fails, the request fails and **nothing is stored** (no synthetic substitute). Demo mode uses
   the synthetic trace, labelled `dataClass: synthetic`.
4. **Engine** (`schedulerService`): hourly candidate windows inside [arrival, deadline], each with its
   mean forecast and deadline-miss risk; five policies evaluated on the same candidates; CarbonRoute
   picks the lowest-forecast window with risk ≤ τ or returns `INFEASIBLE_RISK` / `NO_FEASIBLE_WINDOW`.
   Cost-aware and oracle are reported as unavailable for scheduling.
5. **Wall-clock conversion and explanation**: each policy's window in UTC, its time-weighted forecast
   intensity and estimated emissions (assumed energy); an explanation that quotes the same numbers.
6. **Store**: job (with owner), snapshot, decision (engine version, result, energy assumption).
7. **Dispatch** (`POST /jobs/:id/dispatch`, by the user): Kubernetes Job via `kubectl apply` when a
   cluster is reachable, otherwise a **simulated** execution in which no workload runs. Dispatch is
   immediate on request; there is no timer that starts the job at the recommended time.
8. **Observations** (`POST /jobs/:id/observations`, after the window ends and within 24 h): provider
   history for the scheduled and Immediate windows; each value labelled `measured` or
   `provider-estimate`; missing intervals listed, never filled.
9. **Evaluation and report**: forecast error over matched intervals, time-weighted forecast vs observed
   intensity for both windows, estimated (assumed-energy) emissions; realized emissions only with
   measured energy (never available today). Oracle on request, offline only.

## Data flow: experiments (offline scripts)

```
npm run collect  -> em-collection/collection-<date>.jsonl   (real forecasts + realized history, hourly)
                       |
      +----------------+-----------------+--------------------+
      v                v                 v                    v
npm run coverage  npm run benchmark  npm run ml          npm run demo
(quality per      (forecast accuracy (forecast-error     (one job replayed through
 zone)             + replay of 5     model with          the production workflow,
                   policies on       pre-registered      plus benchmark and ML
                   synthetic         thresholds)         summaries)
                   workloads)
                       |                 |
                       v                 v
              benchmark-results/   ml-results/  --->  GET /api/results/*  --->  Results page
```

Every result file records the git commit, the SHA-256 of its input files and its configuration/seed.

## Trust boundaries and security

- Secrets only in environment variables (`.env` git-ignored; `.dockerignore` keeps `.env` and local
  databases out of images). Production refuses to start without a valid `JWT_SECRET`.
- Users see only their own jobs (other ids answer 404); administrator access to other users' jobs is
  audited.
- Provider quota protected by authentication on live routes, per-user rate limits and a server-wide
  call budget.
- Kubernetes manifests are built as objects and passed to `kubectl` as JSON with argument arrays
  (no shell); pods run unprivileged with no service-account token.

## What the architecture does not have

No relational database (JSON files, single process), no job queue or capacity model, no automatic
start at the recommended time, no multi-replica support (rate limits and caches are in memory), no
electricity-price provider, no measured energy, no calibrated forecast uncertainty.

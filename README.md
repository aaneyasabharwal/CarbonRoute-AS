# CarbonRoute

> **Uncertainty-aware batch workload scheduling under carbon forecast errors**
> Final-year capstone / software engineering project (UCS503). Course supervisor: Sukhpal Singh.
> Team TriFlux: Yuvika Nagpal (1024030141), Kumkum Gupta (1024030144), Aaneya Sabharwal (1024030147).

CarbonRoute schedules a batch job into a lower-carbon time window using a real carbon-intensity
forecast (Electricity Maps), while keeping the modelled probability of missing the job's deadline below
a tolerance τ. Every decision stores the forecast it used, explains itself, is compared with four other
policies, and can later be checked against what the grid actually did.

**Status (November 2026): research prototype, not production-ready.** What works, what is only
partly validated and what is missing is listed in [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md). In short:

| Works and is tested | Limited or not done |
|---|---|
| Live Electricity Maps forecasts with provenance; measured vs estimated values kept apart | 5 h of collected data (needs ≥ 7 days); no evidence of carbon savings yet |
| Risk-constrained scheduling engine, 5 policies, explicit infeasible results, explanations | Deadline risk uses a **declared** runtime variability, not calibrated |
| Accounts, ownership, revocable tokens, rate limits, provider call budget, CORS allow-list | JSON-file storage, single process; token stored in browser `localStorage` |
| Observation collection, forecast-vs-realized reports, offline oracle | No measured energy (emissions use an assumed model) |
| Replay benchmark and forecast-error ML pipeline with pre-registered rules | ML model **not trained** (insufficient data); no cost-aware policy (no price data) |
| Reproducible demo on collected data | Execution is simulated unless a Kubernetes cluster is connected; dispatch is manual |

## Architecture

```
React SPA (frontend/) --HTTPS/JSON--> Express API (backend/) --> Electricity Maps API v3
                                         |  scheduling engine, explanations, reports
                                         |  JSON database + scheduling store (database/)
                                         +--> kubectl / Kubernetes (optional; otherwise simulated)
Offline scripts (backend/): collect -> benchmark / ml / coverage / demo -> ../CarbonRoute-AS-data/
```

Details and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

Requirements: Node.js 20, npm. Optional: Python 3.12 (legacy FastAPI service tests), `kubectl` with a
cluster, Docker.

```bash
git clone <repository> && cd CarbonRoute-AS
cp .env.example .env        # then fill in values; see docs/ENVIRONMENT.md (never commit .env)
cd backend && npm ci && npm run build && cd ..
cd frontend && npm ci && cd ..
```

For live data set `ELECTRICITY_MAPS_API_KEY` in `.env`. Without it, live scheduling fails with a clear
error and only the labelled synthetic demo mode works. In development the server uses a random JWT
secret per process; set `ADMIN_PASSWORD` to create the first admin, or create an ordinary account:

```bash
cd backend
NEW_USER_USERNAME=demo NEW_USER_EMAIL=demo@example.org NEW_USER_PASSWORD='<choose one>' npm run user:create
```

## Running

```bash
cd backend && npm run dev      # API on http://localhost:5000
cd frontend && npm run dev     # app on http://localhost:5173
```

Main pages: **Prototype** (schedule a job, explanation, policy comparison, dispatch), **My Jobs**
(decisions, cancel, collect observations, report), **Results** (benchmarks and model evaluation).
The other pages (Home, Project, How it works, Architecture, System design, Roadmap, Team, Resources,
Presentations) are project information.

Production build: `npm run build` in each of `backend/` (then `npm start`) and `frontend/`. Docker:
`docker compose -f docker/docker-compose.yml up -d --build`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
for prerequisites; the hosted frontend deploys only from `main`.

## Experiments and demo (offline, in `backend/` after `npm run build`)

```bash
npm run collect  -- --out ../../CarbonRoute-AS-data/em-collection --runs 25   # hourly collection (API key)
npm run coverage -- --data ../../CarbonRoute-AS-data/em-collection            # data quality per zone
npm run benchmark -- --data ../../CarbonRoute-AS-data/em-collection           # forecast accuracy + policy replay
npm run ml       -- --data ../../CarbonRoute-AS-data/em-collection            # forecast-error model (gated)
npm run demo     -- --data ../../CarbonRoute-AS-data/em-collection            # one job end to end, reproducible
```

Results are written outside the repository. Current numbers and their limits:
[docs/RESEARCH_SUMMARY.md](docs/RESEARCH_SUMMARY.md).

## Tests

```bash
cd backend && npm run typecheck && npm test && npm run build
cd frontend && npm run typecheck && npm test && npm run build
python -m unittest discover -s fastapi_service/tests -v
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all three on every pull request into
`fix/prototype-flaws` or `main` and on pushes to `task/**`. Tests use fixtures and temporary folders;
they make no provider calls and read no secrets. Legacy scripts in `tests/` need a running server and
are not part of CI.

## Documentation

| Document | Content |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, trust boundaries |
| [SCHEDULING_METHODOLOGY.md](docs/SCHEDULING_METHODOLOGY.md) | Candidate windows, deadline-risk formula, policies, energy, limitations |
| [EXPERIMENTS.md](docs/EXPERIMENTS.md) | Benchmark and forecast-accuracy method, how to interpret results |
| [ML.md](docs/ML.md) | Forecast-error model, pre-registered thresholds, current status |
| [RESEARCH_SUMMARY.md](docs/RESEARCH_SUMMARY.md) | Evaluation summary with actual results, sample counts and threats to validity |
| [DEMO.md](docs/DEMO.md) | Reproducible demo on collected data and live walkthrough |
| [COLLECTOR.md](docs/COLLECTOR.md) | Running, checking and safely restarting data collection |
| [ELECTRICITY_MAPS.md](docs/ELECTRICITY_MAPS.md) | Provider capabilities verified, measured vs estimated data, coverage |
| [API_SPEC.md](docs/API_SPEC.md) | REST endpoints, authentication, ownership, errors |
| [ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Security settings, Docker, hosted setup, credential rotation |
| [FINAL_REPORT.md](docs/FINAL_REPORT.md) | Verification results, defects, limitations, completion status |

`docs/PROTOTYPE_IMPLEMENTATION.md` and `docs/PROTOTYPE_DEMO.md` describe the September prototype and are
kept for history only; parts of them (the old risk model) are invalid.

## Team TriFlux (UCS503)

| Member | Roll number | Focus area |
|---|---|---|
| Yuvika Nagpal | 1024030141 | Grid carbon intensity service and workload profiling |
| Kumkum Gupta | 1024030144 | Scheduling policies, uncertainty and risk modelling |
| Aaneya Sabharwal | 1024030147 | Backend controllers, Kubernetes connector and prototype UI |

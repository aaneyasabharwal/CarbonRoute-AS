# Original prototype vs final implementation

Original: `main` @ `80b411a` (2026-09-17). Final: `fix/prototype-flaws` after PR #27 (2026-11-14),
deployed on free Render staging. Evidence is code, tests, Git history (88 commits, PRs #14–#27)
and the deployed application. Per-phase detail: [FINAL_REPORT.md](FINAL_REPORT.md).

**Classification key:** ✅ fully implemented and verified · 🌐 implemented but unavailable in the
public demo · 🟡 partially implemented · 🧪 still prototype-level · ❌ not implemented.

## 1. Area-by-area audit

| # | Area | Original prototype (`80b411a`) | Final | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Scheduling algorithms | 5 policies in one function; "risk" used a synthetic carbon σ and an uncertainty multiplier | 5 policies on identical snapshot and candidates (Immediate, EDF, Greedy deterministic-carbon, CarbonAware baseline, CarbonRoute risk-constrained); Oracle offline only; cost-aware reported unavailable (no price data) | ✅ (cost-aware ❌) | `schedulerService.ts`, `test/scheduling/*` |
| 2 | Electricity Maps integration | single call, failures fell back to synthetic data | v3 client: zones, latest, 24 h history, 6–72 h forecasts, quality labels (measured / estimate), caching, call budget, explicit errors, no silent fallback | ✅ code; 🌐 on the free demo (no key) | `carbon/electricityMaps.ts`, `test/carbon/*` |
| 3 | Global geographical coverage | 4 hard-coded regions + a synthetic benchmark | **351-zone catalogue** (207 countries, 5 continents), searchable selector, honest availability levels; live verified for 7 zones | ✅ catalogue and selector; 🌐 live data for 344 zones never verified | [GLOBAL_ZONES.md](GLOBAL_ZONES.md) |
| 4 | Forecast uncertainty | invented σ (default 20 gCO2eq/kWh) presented as uncertainty | none invented: the provider gives no uncertainty, so none is shown; forecast error measured (MAE/RMSE/bias by lead time) against realized values | 🟡 (bands computed in research only, not used in decisions) | `benchmark/forecastAccuracy.ts`, RESEARCH_SUMMARY |
| 5 | Deadline and risk management | risk mixed carbon σ (gCO2eq/kWh) with runtime σ (hours) — dimensionally inconsistent | P(miss) = 1 − Φ((D − t − d)/(cv·d)) from a *declared* runtime CV; exact deadline and arrival instants | ✅ formula; 🧪 runtime CV is declared, not calibrated | [SCHEDULING_METHODOLOGY.md](SCHEDULING_METHODOLOGY.md), `exactInstants.test.ts` |
| 6 | Job lifecycle and dispatch | in-memory, client-generated results | persisted jobs, decisions, executions; ownership; single dispatch (also concurrent); interrupted runs; cancellation; HTML/JSON reports; simulated dispatch labelled | ✅ simulated; 🌐 Kubernetes never run on a real cluster | `test/features/jobLifecycle.test.ts` |
| 7 | Experiments and benchmarks | none (page said "results pending") | replay benchmark on real forecasts/realized values, identical synthetic workloads per policy, seeded, cluster-bootstrap CIs, oracle regret, reproducible report with guardrails | ✅ (data: 1 day) | `benchmark/*`, `npm run report`, `results/published/` |
| 8 | ML pipeline | none | leakage-checked dataset, chronological splits with gaps, baselines, ridge candidate, pre-registered promotion rule, insufficient-data gating | ✅ pipeline; ❌ no trained model (insufficient data, correctly) | [ML.md](ML.md), `test/ml/*` |
| 9 | Dashboard and analytics | placeholder "coming soon" panels | real data: provider and execution status, jobs, latest benchmark read with the report's rule, model status | ✅ | `DashboardPage.tsx`, tests |
| 10 | Authentication and accounts | hard-coded admin password and JWT secret in the repo | bcrypt, required secrets, JWT HS256 12 h, revocation, password change cutting older tokens, admin-created accounts, roles, login rate limits, constant-cost login | ✅ | [SECURITY.md](SECURITY.md), `test/security/*` |
| 11 | Backend architecture | Express monolith, JSON file DB | same architecture, hardened: validation, error references, rate limits, isolated test env, provider client, stores | ✅ (JSON storage ❌ PostgreSQL) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 12 | Frontend architecture | React/Vite pages, overlapping 14-link navbar | typed API client, state views (loading/empty/error/sign-in), global selector, responsive navigation verified at 6 viewports, wake-up banner | ✅ | `frontend/test/*` (134 tests) |
| 13 | Security | secrets committed, open CORS, path traversal, injection risks | CORS allow-list, CSP, ownership 404s, input validation, Kubernetes manifest as object, generic 500s, retired backend blocked from builds | ✅ | `test/security/*`, CI |
| 14 | Deployment and persistence | Pages from `main` calling a backend that ran old code | free Render staging (API + static site, ₹0, no card), `render.yaml`, staging check script; old backend suspended | ✅ deployed; 🟡 no persistence on the free plan (documented) | [STAGING.md](STAGING.md) |
| 15 | Reproducibility and documentation | none | CI (4 jobs), reproducible benchmarks (seeded; rerun identical), reproducible catalogue (CI-checked), 25+ docs with claim classification | ✅ | `.github/workflows/ci.yml`, `docs/` |

Size: 53 source files → 152; 4 ad-hoc test scripts → **475 automated tests** (backend 341, frontend
134, of which 12 are expected-failure checks of removed original behaviour) + 5 Python tests + CI.

## 2. Ten most important remaining problems (ranked)

Ranking weighs academic importance, technical importance, user-visible impact, effort and dependencies.

| Rank | Problem | Academic | Technical | Visible | Effort | Depends on |
|---|---|---|---|---|---|---|
| 1 | **Only 1 day of real data**: no result is statistically conclusive (needs ≥ 7 days, ≥ 30 clusters) | high | – | medium | low effort, 6+ days of time | collector restart approval; trial key until ~26–27 Nov |
| 2 | **No trained forecast-error model** (insufficient data) | high | medium | low | low once data exists | #1 |
| 3 | **Runtime CV is declared, not calibrated**; deadline violations are simulated | high | medium | low | medium | recorded real runtimes (#6) |
| 4 | **No measured energy**: emissions are estimates (0.125 kW/vCPU assumption) | high | medium | low | high | real execution + power telemetry |
| 5 | **Free demo has no live data and no persistence** | low | medium | high | none in code (₹0 rule) | a key and a paid disk, or a free external DB layer |
| 6 | **No real Kubernetes execution** (simulated dispatch) | medium | medium | medium | medium | a cluster |
| 7 | Live data verified for 7 of 351 zones only | medium | low | medium | low (one call per zone) | key quota (shared with the collector) |
| 8 | Forecast uncertainty bands not used in decisions | medium | medium | low | medium | #1 (enough errors per lead time) |
| 9 | Cost-aware policy unavailable (no price data in the plan) | low | low | low | medium | price data access |
| 10 | Sessions in `localStorage`; JSON-file storage, single instance | low | medium | low | medium–high | – |

All ten are documented with their blocker; none is hidden by the UI or the reports.

## 3. What genuinely improved (summary)

1. **Correctness of the core model**: the dimensionally inconsistent risk model and the invented
   uncertainty were removed; deadline risk uses exact instants and a stated runtime model.
2. **Real data and honest labelling**: real forecasts and realized values (measured vs estimated),
   synthetic data always labelled, no silent fallback or region substitution.
3. **Global applicability**: 351 zones on every inhabited continent, with time zones checked
   against IANA, instead of 4 hard-coded regions.
4. **Research infrastructure**: reproducible benchmark, statistics that respect clustering, a
   pre-registered ML pipeline that refuses to train on insufficient data.
5. **A real product**: accounts and roles, job lifecycle, reports, dashboard, responsive UI, CI,
   security hardening, and a public ₹0 deployment.

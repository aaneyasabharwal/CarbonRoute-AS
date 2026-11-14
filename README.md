# CarbonRoute

> **Uncertainty-aware batch workload scheduling under carbon forecast errors**
> Final-year capstone / software engineering project (UCS503). Course supervisor: Sukhpal Singh.
> Team TriFlux: Yuvika Nagpal (1024030141), Kumkum Gupta (1024030144), Aaneya Sabharwal (1024030147).

CarbonRoute schedules a batch job into a lower-carbon time window using a real carbon-intensity
forecast (Electricity Maps), while keeping the modelled probability of missing the job's deadline below
a tolerance τ. Every decision stores the forecast it used, explains itself, is compared with four other
policies, and can later be checked against what the grid actually did.

**Live demo (free hosting, synthetic data):** https://aaneyasabharwal.github.io/CarbonRoute-AS/
(GitHub Pages) or https://carbonroute-staging-web.onrender.com (Render); both use the API
https://carbonroute-staging-api.onrender.com and share its accounts and jobs. The free backend sleeps when idle (about a minute
to wake) and keeps no data across restarts. Demonstration script: [docs/DEMONSTRATION.md](docs/DEMONSTRATION.md).

**Status (15 November 2026): working research system, not production-ready.** Submission documents:
[handover](docs/HANDOVER.md) · [validation report](docs/VALIDATION_REPORT.md) ·
[original vs final](docs/ORIGINAL_VS_FINAL.md) · [research report](docs/RESEARCH_REPORT.md) ·
[global zones](docs/GLOBAL_ZONES.md) · [screenshots](docs/screenshots/) · **[team handbook](docs/TEAM_HANDBOOK.md)** (everything in one place). In short:

| Works and is tested | Limited or not done |
|---|---|
| **Global zone catalogue: all 351 Electricity Maps zones** (207 countries), IANA time zones, honest availability (7 verified live, 4 synthetic demo); searchable selector | Live data verified for 7 zones; the free demo has no provider key (synthetic data only) |
| Live Electricity Maps forecasts with provenance; measured vs estimated values kept apart; no silent fallback or region substitution | 1 day of collected data (needs ≥ 7 days); results not statistically conclusive |
| Risk-constrained scheduling engine, 5 policies, explicit infeasible results, explanations | Deadline risk uses a **declared** runtime variability, not calibrated |
| Accounts (admin-issued), password change, ownership, revocable tokens, rate limits, provider call budget, CORS allow-list, CSP | JSON-file storage, single process; no persistence on the free demo; token in `localStorage` (12 h) |
| Job lifecycle with persisted execution status; observation collection, forecast-vs-realized reports, offline oracle | No measured energy (emissions use an assumed model) |
| Replay benchmark (reproducible) and forecast-error ML pipeline with pre-registered rules | ML model **not trained** (insufficient data); no cost-aware policy (no price data) |
| Responsive UI verified at 6 viewports; public ₹0 deployment; CI (backend, frontend, Python, Docker, collector lock, catalogue) | Execution is simulated unless a Kubernetes cluster is connected |


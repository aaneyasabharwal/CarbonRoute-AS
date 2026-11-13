# Research summary: methodology, evaluation and current evidence

Status as of 2026-11-13 19:23 UTC. Every number below comes from a stored result file (paths at the
end) produced by the scripts in this repository. Nothing is extrapolated. **The data covers 5 hours of
one day, so none of these numbers supports a general claim about carbon savings or forecast quality.**

## 1. Question

Can a batch job be shifted to a cleaner time window, using a real carbon-intensity forecast, while
keeping the probability of missing its deadline below a user tolerance τ, and how does that compare
with simple policies when scored on what the grid actually did?

## 2. Method (summary; details in [SCHEDULING_METHODOLOGY.md](SCHEDULING_METHODOLOGY.md))

- **Forecast**: Electricity Maps v3 hourly forecast, stored as an immutable snapshot with its hash.
- **Candidate windows**: whole-hour starts between arrival and deadline; window intensity = mean
  forecast over the window. No gap filling, no wrap-around, no deadline moving.
- **Deadline risk** (runtime only): runtime ~ Normal(d, (cv·d)²) with a **declared** cv;
  P(miss) = 1 − Φ((D − t − d)/(cv·d)). cv = 0 is deterministic. Carbon-forecast error does not enter
  the deadline risk (it affects emissions, not completion time).
- **Policies**: Immediate; EDF (identical to Immediate for single jobs); Greedy (lowest forecast,
  ignores risk); CarbonAware baseline (25th-percentile threshold with a safety buffer); **CarbonRoute**
  (lowest forecast subject to P(miss) ≤ τ; explicit infeasible result otherwise). Cost-aware is
  unavailable (no price data). The hindsight Oracle is offline evaluation only.
- **Scoring**: realized intensity from the provider's history, time-weighted over each window, each
  value labelled measured or provider-estimate. Emissions use an **assumed** energy model.

## 3. Experiment design ([EXPERIMENTS.md](EXPERIMENTS.md))

- **Data (real)**: hourly collection of forecasts and history for DE, FR, GB, IN-NO and US-CAL-CISO
  since 2026-11-13 13:32 UTC.
- **Workloads (synthetic, seeded)**: 20 per snapshot, duration 1–4 h, slack 0–12 h, τ = 0.05, declared
  cv ∈ {0, 0.2}; simulated runtimes for violations.
- **Paired comparison**: every policy schedules the same workload on the same snapshot; the difference
  to Immediate is computed on workloads where both windows are fully observed.
- **Uncertainty**: 95 % percentile bootstrap, **clustered by forecast snapshot** (workloads replayed on
  one snapshot share its forecast and realized hours, so they are not independent). Neighbouring
  snapshots remain correlated, so intervals may still be optimistic.
- **Reproducibility**: each result stores git commit, configuration hash, seed and input-file hash.

## 4. Data collected

| | Value |
|---|---|
| Collection runs / calls / failures | 6 / 60 / 0 |
| Span | 5.0 h (13:32–18:32 UTC, 2026-11-13) |
| Forecast snapshots | 30 (6 per zone) |
| Realized hourly values | 145; measured share 61.4 % (DE 0.93, FR 0.97, GB 0, IN-NO 0.17, US-CAL-CISO 1.0) |
| Forecast/realized pairs (lead 0–5 h) | 105, of which 46 measured |

GB realized values are all provider estimates; IN-NO mostly. Any result for those zones compares a
forecast with another model's estimate.

## 5. Results

### 5.1 Forecast accuracy (forecast − realized, gCO2eq/kWh, 21 pairs per zone)

| Zone | MAE | RMSE | Bias | MAE vs measured only (n) |
|---|---|---|---|---|
| DE | 36.24 | 36.68 | +36.24 | 32.20 (10) |
| GB | 41.19 | 41.37 | −41.19 | n/a (0) |
| US-CAL-CISO | 16.76 | 20.64 | −10.76 | 16.76 (21) |
| IN-NO | 13.43 | 13.77 | +13.43 | n/a (0) |
| FR | 9.57 | 10.26 | −8.90 | 8.47 (15) |
| All | 23.44 (n=105) | | | 17.41 (n=46) |

21 pairs per zone from one afternoon, short leads only; error bands (≥ 30 pairs per lead bucket) are
not yet available. The large one-sided biases (DE, GB) may be specific to that afternoon.

### 5.2 Policy comparison (replay benchmark, 600 synthetic workloads per scenario)

Paired difference in realized intensity vs Immediate (negative = cleaner), 95 % cluster-bootstrap
interval over snapshots:

| Policy | cv = 0: Δ [95 % CI] (n, snapshots) | cv = 0.2: Δ [95 % CI] | Violation rate cv = 0.2 |
|---|---|---|---|
| Immediate / EDF | reference | reference | 4.8 % |
| Greedy (deterministic carbon) | −11.08 [−26.28, −1.57] (286, 28) | −11.08 [−26.69, −1.51] | **19.7 %** |
| CarbonAware baseline | −9.78 [−21.03, −0.75] (400, 30) | −9.78 [−21.80, −0.71] | 4.8 % |
| **CarbonRoute** | −11.08 [−27.16, −1.38] (286, 28) | −10.22 [−23.66, −1.31] (274, 30) | **0.9 %** |

- 314 of 600 workloads per scenario could not yet be scored (their windows end after the last
  collection) and 55 were infeasible for CarbonRoute at cv = 0.2 (no window within τ).
- With cv = 0 CarbonRoute and Greedy choose the same windows (no runtime risk), as expected.
- With cv = 0.2, the one consistent pattern is the deadline trade-off: Greedy's simulated violation
  rate was 19.7 % against CarbonRoute's 0.9 %, at a similar paired difference. This follows from the
  constraint by construction and uses simulated runtimes; it is not an empirical runtime result.
- The paired differences are about −10 gCO2eq/kWh with intervals that nearly reach 0. Given 5 hours of
  one day, 5 zones and intervals that may still be optimistic, **this is not evidence of a carbon
  saving**. Mean realized intensities per policy are computed on different subsets and must not be
  compared directly.

### 5.3 Single-job demonstration ([DEMO.md](DEMO.md))

US-CAL-CISO, forecast at 13:32 UTC: CarbonRoute recommended 15:00–17:00 (forecast 197.0); realized
(measured) 230.5 vs Immediate 303.8 gCO2eq/kWh. One job: illustration only.

### 5.4 Forecast-error model (machine learning, [ML.md](ML.md))

Status **insufficient-data**: 105 pairs over 0.21 days; the pre-registered thresholds need ≥ 500 / 100
/ 200 train / validation / test rows over ≥ 7 days. **No model has been trained; no model accuracy
exists.** The pipeline itself is validated only on synthetic test fixtures.

## 6. Threats to validity

- **Duration**: 5 hours of one weekday afternoon; diurnal and weekly patterns are not represented.
- **Dependence**: workloads and snapshots overlap in time; cluster intervals address within-snapshot
  dependence only.
- **Selection**: only windows observed so far are scored; later (often cleaner, evening) windows are
  under-represented until more data arrives.
- **Ground truth**: 39 % of realized values are provider estimates.
- **Deadline risk**: model-based from a declared cv; not calibrated against recorded runtimes; hourly
  discretisation rounds the deadline down to whole forecast hours (conservative).
- **Energy**: assumed, so emissions in grams are illustrative.
- **Synthetic workloads** with a uniform mix; no queueing or capacity.

## 7. What would make the claims testable

At least 7 days of uninterrupted collection (see [COLLECTOR.md](COLLECTOR.md)) before the trial key
expires (~26–27 Nov 2026); then re-run `npm run benchmark` and `npm run ml` and report the same tables
with their intervals, by zone, and for measured values only.

## Result files (outside the repository, `../CarbonRoute-AS-data/`)

- `benchmark-results/benchmark-2026-11-13T19-23-19-164Z.{json,md}` (dataset 6fec27740a4e, config
  a074e5bb9fa8, seed 42)
- `ml-results/ml-2026-11-13T19-23-20-497Z.{json,md}`
- Demo: `npm run demo` output (reproducible; see DEMO.md)

These three were produced from the P6 working tree before it was committed, so their recorded commit
is the parent (1a89f6f); the code that produced them is the P6 commit.

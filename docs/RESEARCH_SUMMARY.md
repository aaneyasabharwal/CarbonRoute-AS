# Research summary: methodology, evaluation and current evidence

Status as of 2026-11-13 23:48 UTC. Every number below comes from a stored result file (paths at the
end) produced by the scripts in this repository; `npm run report` regenerates the full report from
those files. Nothing is extrapolated. **The data covers about 9.5 hours of one day (0.40 days), so none
of these numbers supports a general claim about carbon savings or forecast quality.**

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
| Collection runs / calls / failures | 12 / 120 / 0 |
| Span | 0.40 days (2026-11-13 13:32–23:06 UTC) |
| Forecast snapshots | 60 (12 per zone) |
| Realized hourly values | 170; measured share 61.2 % (DE 0.94, FR 0.97, GB 0, IN-NO 0.15, US-CAL-CISO 1.0) |
| Forecast/realized pairs (lead 0–10 h) | 350, of which 175 measured |

GB realized values are all provider estimates; IN-NO mostly. Any result for those zones compares a
forecast with another model's estimate.

## 5. Results

### 5.1 Forecast accuracy (forecast − realized, gCO2eq/kWh, 70 pairs per zone)

| Zone | MAE | RMSE | Bias | MAE vs measured only (n) |
|---|---|---|---|---|
| DE | 35.57 | 40.14 | +35.57 | 43.94 (47) |
| GB | 22.04 | 27.14 | −17.39 | n/a (0) |
| US-CAL-CISO | 15.41 | 17.19 | −4.96 | 15.41 (70) |
| IN-NO | 11.59 | 11.99 | +11.59 | n/a (0) |
| FR | 9.27 | 9.61 | −9.07 | 8.84 (58) |
| All | 18.78 (n=350) | 24.00 | +3.15 | 20.90 (n=175) |

Each zone now has one lead-time bucket with at least 30 pairs (an empirical error band is available
for it); longer leads still have too few pairs. DE's forecast was consistently above the realized
values throughout this period (bias +35.6); this may be specific to the day.

### 5.2 Policy comparison (replay benchmark, 1 200 synthetic workloads per scenario)

Paired difference in realized intensity vs Immediate (negative = cleaner), 95 % cluster-bootstrap
interval over forecast snapshots, with the reading the report generator assigns (a difference is only
called lower when the interval excludes 0):

| Policy | cv = 0: Δ [95 % CI] (n, snapshots) | cv = 0.2: Δ [95 % CI] (n, snapshots) | Violation rate cv = 0.2 (simulated) |
|---|---|---|---|
| Immediate / EDF | reference | reference | 4.1 % |
| Greedy (deterministic carbon) | −8.06 [−18.50, −0.28] (672, 57) | −8.06 [−17.82, −0.51] (672, 57) | **23.4 %** |
| CarbonAware baseline | −6.39 [−13.57, −0.72] (824, 59) | −6.39 [−13.68, −0.42] (824, 59) | 4.4 % |
| **CarbonRoute** | −8.06 [−17.61, −0.05] (672, 57) | −7.21 [−17.39, **+0.40**] (638, 58): no evidence of a difference | **0.9 %** |

- 528 of 1 200 workloads per scenario could not yet be scored (windows end after the last collection);
  110 were infeasible for CarbonRoute at cv = 0.2 (no window within τ).
- With cv = 0 CarbonRoute and Greedy choose the same windows, as expected (no runtime risk).
- With cv = 0.2 the consistent pattern is the deadline trade-off: Greedy's simulated violation rate
  was 23.4 % against CarbonRoute's 0.9 %. This follows from the constraint by construction and uses
  simulated runtimes; it is not an empirical runtime result.
- With the larger sample, CarbonRoute's cv = 0.2 interval now **includes 0** (it excluded 0 on the
  5-hour sample). The other differences remain small and their intervals end close to 0. **This is not
  evidence of a carbon saving**; per-policy means are over different subsets and are not compared.
- Scheduler overhead (machine-dependent): median 0.027 ms, 95th percentile 0.093 ms per decision for
  all five policies (300 decisions, Intel Core Ultra 7 155U, Node 24).

### 5.3 Single-job demonstration ([DEMO.md](DEMO.md))

US-CAL-CISO, forecast at 13:32 UTC: CarbonRoute recommended 15:00–17:00 (forecast 197.0); realized
(measured) 230.5 vs Immediate 303.8 gCO2eq/kWh. One job: illustration only.

### 5.4 Forecast-error model (machine learning, [ML.md](ML.md))

Status **insufficient-data**: 350 pairs (175 measured) over 0.40 days; chronological split 140 / 9 / 21
(180 dropped by the leakage gap). The pre-registered thresholds need ≥ 500 / 100 / 200 train /
validation / test rows over ≥ 7 days. **No model has been trained; no model accuracy exists.** The
pipeline itself is validated only on synthetic test fixtures.

### 5.5 Earlier sample (5 h, 2026-11-13 19:23 UTC)

On the first 6 collection runs the same comparison gave CarbonRoute −10.22 [−23.66, −1.31] at cv = 0.2
(30 snapshots). The change with more data illustrates why short samples must not be over-interpreted.

## 6. Threats to validity

- **Duration**: about 9.5 hours of one day; diurnal and weekly patterns are not represented.
- **Dependence**: workloads and snapshots overlap in time; cluster intervals address within-snapshot
  dependence only.
- **Selection**: only windows observed so far are scored; later (often cleaner, evening) windows are
  under-represented until more data arrives.
- **Ground truth**: 39 % of realized values are provider estimates.
- **Deadline risk**: model-based from a declared cv; not calibrated against recorded runtimes. (The
  replay uses whole-hour arrivals and deadlines; the exact-instant fix of P8 does not change it.)
- **Energy**: assumed, so emissions in grams are illustrative.
- **Synthetic workloads** with a uniform mix; no queueing or capacity.

## 7. What would make the claims testable

At least 7 days of uninterrupted collection (see [COLLECTOR.md](COLLECTOR.md)) before the trial key
expires (~26–27 Nov 2026); then re-run `npm run benchmark` and `npm run ml` and report the same tables
with their intervals, by zone, and for measured values only.

## Result files (outside the repository, `../CarbonRoute-AS-data/`)

- `benchmark-results/benchmark-2026-11-13T23-48-22-308Z.{json,md}` (dataset 46a5a644d1b4, config
  a074e5bb9fa8, seed 42, commit 1ba4508)
- `ml-results/ml-2026-11-13T23-48-23-207Z.{json,md}`
- `reports/research-report-2026-11-13T23-48-22-308Z.{md,json}` (`npm run report`)
- Earlier (5 h sample): `benchmark-2026-11-13T19-23-19-164Z`, `ml-2026-11-13T19-23-20-497Z`
- Demo: `npm run demo` output (reproducible; see DEMO.md)

The 23:48 results were produced by the code of `fix/prototype-flaws` at 1ba4508 plus the report
generator (branch `task/p8-research-report`); the benchmark and ML code are unchanged from 1ba4508.

# CarbonRoute: uncertainty-aware carbon-aware scheduling of batch workloads — research report

Team TriFlux, UCS503 Software Engineering. Status 2026-11-14. Detailed sources:
[SCHEDULING_METHODOLOGY.md](SCHEDULING_METHODOLOGY.md), [EXPERIMENTS.md](EXPERIMENTS.md),
[ML.md](ML.md), [RESEARCH_SUMMARY.md](RESEARCH_SUMMARY.md), [GLOBAL_ZONES.md](GLOBAL_ZONES.md),
the generated report `results/published/reports/research-report-2026-11-14T14-30-03-628Z.md`.

## 1. Problem statement

Flexible batch jobs (training, pipelines, backups) can often start at any time before a deadline.
The carbon intensity of grid electricity varies by hour and by region, so *when* a job runs changes
its emissions. A scheduler that simply picks the lowest *forecast* intensity faces two kinds of
uncertainty: the forecast may be wrong, and the job may run longer than planned and miss its
deadline. The project asks: **how much forecast carbon intensity can a scheduler avoid while keeping
the probability of missing a deadline below a stated tolerance, using real forecasts?**

## 2. Objectives

1. A working platform: submit a job, obtain a scheduling decision with an explanation, dispatch
   (simulated or Kubernetes), and inspect results; accounts, roles and ownership.
2. A decision model with an explicit, testable deadline-risk constraint.
3. Global applicability: any grid zone of the Electricity Maps catalogue (351 zones).
4. A reproducible evaluation on real forecasts and realized values, comparing policies fairly.
5. An honest machine-learning extension that only trains with enough data.

## 3. Background (scope of this report)

The work uses Electricity Maps carbon-intensity forecasts and realized values (lifecycle emission
factors, hourly) as the data source. Carbon-aware scheduling by temporal shifting and the use of
forecast uncertainty are established ideas; **this report does not include a literature review, and
no academic citations are given**. References below are limited to the data sources and tools actually
used. A literature review is future work for the team.

## 4. Proposed system

React/Vite frontend, Express/TypeScript backend with a JSON-file store, an Electricity Maps v3
client, a scheduling engine, a scheduling workflow (snapshot → candidates → policies → explanation
→ stored decision), simulated or Kubernetes dispatch, an offline research pipeline (collector,
replay benchmark, forecast accuracy, ML, report generator) and a global zone catalogue.
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md).

## 5. Methodology and algorithms

- **Candidates**: every start slot from arrival to the last slot that can end by the deadline,
  hourly, on one forecast snapshot (exact arrival and deadline instants; UTC).
- **Deadline risk**: runtime R ~ Normal(d, (cv·d)²) with a *declared* cv;
  P(miss | start t) = 1 − Φ((D − t − d)/(cv·d)); with cv = 0 it is 0 or 1.
- **Policies** (same snapshot, same candidates): Immediate; EDF (= Immediate for one job); Greedy
  (lowest forecast, ignores risk); CarbonAware baseline (25th-percentile forecast with a fixed buffer);
  **CarbonRoute** (lowest forecast subject to P(miss) ≤ τ). Oracle (hindsight, realized values) is
  offline only. Cost-aware is unavailable (no price data in the plan).
- **Emissions** = energy × intensity; energy is an assumption (0.125 kW per vCPU, min 0.1 kW).

## 6. Experimental setup

- **Data**: an hourly collector (5 zones: DE, FR, GB, IN-NO, US-CAL-CISO) records 24 h forecasts and
  24 h realized history; frozen snapshot 2026-11-14 14:40 UTC: 115 forecast snapshots, 1.00 day,
  dataset `0e9b960c6b21`, 240 realized hourly values of which 65.8 % measured (the rest are provider
  estimates).
- **Workloads**: synthetic and seeded (seed 42; 20 per snapshot; durations 1, 2, 3, 4 h; slack up to
  12 h; 2 vCPU); every policy sees identical workloads; 2,000 bootstrap iterations.
- **Scenarios**: runtime cv 0 and 0.2; τ = 0.05.
- **Metrics**: mean realized intensity of the chosen window, paired difference vs Immediate with a
  95 % cluster-bootstrap interval over snapshots, mean delay, simulated deadline-violation rate,
  regret vs the hindsight oracle, estimated emissions (assumed energy).
- **Guardrails** (automatic in the report): a difference is "lower/higher" only if its interval
  excludes 0; < 7 days or < 30 clusters → "not statistically conclusive".

## 7. Results (1.00 day, runtime cv 0.2)

| Policy | Δ vs Immediate, gCO2eq/kWh [95 % CI] | Mean delay h | Simulated violations | Regret vs oracle |
|---|---|---|---|---|
| Immediate / EDF | reference | 0.00 | 4.2 % | 32.61 |
| Greedy | −27.91 [−37.49, −18.94] | 3.17 | **20.0 %** | 3.05 |
| CarbonAware baseline | −15.80 [−21.90, −10.07] | 1.47 | 4.7 % | 16.45 |
| **CarbonRoute** | **−25.16 [−33.60, −16.86]** | 2.80 | **0.8 %** | 10.04 |

Forecast accuracy and per-zone data quality are in the generated report. **ML**: insufficient data
(1,655 pairs; split 415/55/104 vs required 500/100/200 over ≥ 7 days); **no model was trained**.

## 8. Discussion

In this one-day sample, CarbonRoute obtained most of Greedy's reduction in realized intensity while
keeping simulated deadline violations at 0.8 % instead of 20 %: the risk constraint is doing what it
is designed to do. The earlier 0.40-day sample showed no evidence of a difference (interval included
0), which illustrates how unstable short samples are. **The result is not statistically conclusive**:
one day covers one diurnal cycle, snapshots of neighbouring hours are correlated, the violations rest
on a declared runtime model, and emissions use assumed energy.

## 9. Limitations

1 day of data; 5 zones in the experiment (7 verified live, 351 in the catalogue); synthetic
workloads; declared, uncalibrated runtime variability; assumed energy (no measurement); simulated
execution; realized values partly estimated by the provider; no trained model; free public demo
without live data or persistence. Full list: [ORIGINAL_VS_FINAL.md](ORIGINAL_VS_FINAL.md) §2.

## 10. Future work

Collect ≥ 7 days (the collector is ready; restart needs approval) and rerun the frozen-snapshot
pipeline; train and evaluate the forecast-error model under the pre-registered rule; record real
runtimes to calibrate cv; measure energy on real executions; verify live data for more zones; use
forecast-error bands in decisions; add price data for a cost-aware policy; a literature review.

## 11. References and data sources

- Electricity Maps API v3 (carbon-intensity forecast, history, latest, zones): https://app.electricitymaps.com/docs
- Electricity Maps zone list (public): `GET https://api.electricitymap.org/v3/zones`
- electricitymaps-contrib zone configuration (AGPL-3.0): https://github.com/electricitymaps/electricitymaps-contrib
- IANA time zone database (public domain): https://github.com/eggert/tz
- UN M49 regions via ISO-3166-Countries-with-Regional-Codes (CC BY-SA 4.0): https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes
- Render free services documentation: https://render.com/docs/free

# Experiments: forecast accuracy and policy comparison

This describes how CarbonRoute's experiments are run and what they can and cannot show. Results are
produced by scripts and written outside the repository; this document does not contain results.

## Data

- **Carbon data (real).** `npm run collect` calls Electricity Maps every hour for a list of zones and
  stores the 24 h forecast and the last 24 h of history (one JSON line per call, including failures).
  The key is read from the environment and never stored. The collection used in the November 2026
  sprint covers DE, GB, US-CAL-CISO, IN-NO and FR, hourly, starting 2026-11-13 13:32 UTC.
- **Realized values** are the provider's history. Each value keeps its quality: `measured` or
  `provider-estimate` (e.g. India's values are estimates). Accuracy is reported for all realized values
  and for measured values only. When an interval is fetched more than once, the latest revision is used.
- **Workloads (synthetic).** Generated from a seed: duration 1–4 h, slack 0–12 h, arrival at the start of
  each forecast snapshot. They are labelled `synthetic`; no claim is made about real workload mixes.

## Forecast accuracy (`benchmark/forecastAccuracy.ts`)

Each forecast point is paired with the realized value for the same hour, when it exists. Lead time is
counted from the start of the hour in which the forecast was fetched. Reported per zone: MAE, RMSE,
bias (forecast − realized), by lead-time bucket and by realized quality. **Forecast uncertainty** is
reported only as an empirical error band (5th/50th/95th percentile of forecast − realized) per lead
bucket, and only with at least 30 pairs; otherwise it is `insufficient-data`. It is not used for
deadline risk, which depends only on runtime (see SCHEDULING_METHODOLOGY.md).

## Policy comparison (`benchmark/replay.ts`)

For every forecast snapshot, every synthetic workload is scheduled by every policy on that same
snapshot (identical inputs). Each chosen window is scored on realized values (time-weighted over the
window). Windows not yet fully observed are not scored and are counted as `pendingRealized`.

| Metric | Definition |
|---|---|
| Realized intensity | Time-weighted realized gCO2eq/kWh over the chosen window |
| Δ vs Immediate | Paired mean of (policy − Immediate) realized intensity on the same workloads, with a 95 % percentile-bootstrap interval |
| Delay | Hours between arrival and start |
| Deadline violations | Share of workloads whose simulated runtime Normal(d, (cv·d)²) ends after the deadline; impossible when cv = 0 |
| Regret vs Oracle | Realized intensity minus the Oracle's (hindsight best candidate), only when every candidate window is fully observed |
| Estimated emissions | Realized intensity × **assumed** energy (0.125 kW per vCPU); not measured |

Each run records the git commit, a SHA-256 of the configuration, a SHA-256 of the input files and the
seed; the same inputs and seed reproduce the same numbers exactly (tested).

## Reproducing

```bash
cd backend && npm run build
npm run collect -- --out ../../CarbonRoute-AS-data/em-collection --runs 25
npm run benchmark -- --data ../../CarbonRoute-AS-data/em-collection --seed 42 --workloads 20
```

## Limitations

- Hours of collection, not weeks: confidence intervals are wide or unavailable, and lead times beyond
  the collection period cannot be evaluated. Statements about policy performance need the intervals.
- Realized values partly consist of provider estimates.
- The Electricity Maps plan exposes only the last 24 h of history, so a window must be collected within
  24 h of ending; later windows can never be scored.
- Workloads are synthetic; energy is assumed; there is no capacity model.

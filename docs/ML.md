# Forecast-error model (machine learning)

CarbonRoute includes a pipeline that learns to correct the carbon-intensity forecast from its past
errors. This document describes it and states plainly what it can claim today. **No trained model
exists yet**: the collected data does not meet the thresholds below.

## Task

Predict the realized carbon intensity of an hour from the provider's forecast for that hour, using
only information available when the forecast was fetched. The model predicts the forecast **error**
(forecast − realized) and subtracts it from the forecast.

## Data (`backend/src/ml/dataset.ts`)

One row per (forecast snapshot, forecast hour) whose realized value has been collected
(`npm run collect`). Features available at fetch time only:

- zone; lead time (hours from the fetch hour); hour of day (UTC);
- the forecast value;
- the last realized value already known at fetch time, taken from the history fetched in the same
  collection run, for an hour that had ended (`assertNoLeakage` checks this).

Targets keep their quality: **measured** or **provider estimate**. Metrics are reported for all
realized values and for measured values only, and each split reports how many of its rows are
measured. Training uses both (the target's quality is not known when the forecast is issued, so it
cannot be a feature); promotion additionally requires no degradation on measured values.
Observations are matched to forecasts by zone and by the hour as an instant (not as a string).

**Splits** are chronological by fetch time (60 % train, 20 % validation, 20 % test). A row is kept in
an earlier split only if its target hour ended before the next split begins, so no later split
contains information the earlier targets could have used.

## Models (`backend/src/ml/models.ts`)

| Model | Rule |
|---|---|
| provider-as-is | the forecast (reference) |
| bias-corrected | forecast − mean error per (zone, lead bucket) on the training split |
| persistence | last realized value known at fetch time |
| **ridge-error-correction** (candidate) | ridge regression of the error on: forecast, lead, lead², hour of day (sin/cos), lag difference, zone one-hot and zone × lead. Features standardised on train; the regularisation strength is chosen on **validation** only. |

## Pre-registered rules (`backend/src/ml/pipeline.ts`)

Fixed in code before any evaluation:

- **Training thresholds:** at least 500 training, 100 validation and 200 test rows, spanning at least
  7 days. Below them the status is `insufficient-data` and **no model is fitted**.
- **Promotion** (all must hold, otherwise `evaluated-not-promoted`):
  - the candidate's test MAE is ≤ 95 % of the best baseline's;
  - the 95 % interval of the paired difference (|candidate error| − |baseline error|) lies entirely
    below 0, computed by a **cluster bootstrap over target hours**, with at least 30 distinct target
    hours in the test period;
  - when the test period has ≥ 30 **measured** rows, the candidate is not worse than the best baseline
    on measured values alone (otherwise the report states that the result relies on provider estimates).
- **Amendment (PR #13 review, 2026-11-13).** The first version resampled individual rows and checked
  only pooled values. The review found that the same target hour is predicted by up to 24 snapshots,
  so rows are not independent (a row bootstrap gives intervals that are far too narrow), and that
  pooling lets provider estimates decide promotion. The rule was amended before any evaluation had
  run: every run on real data so far was `insufficient-data`.
- Rows of the same target hour are still correlated with neighbouring hours; the cluster interval
  does not model that serial correlation and may remain somewhat optimistic.
- Promotion only means "better than the baselines on the held-out test period". The model is **not**
  used by the scheduler (that would be roadmap task M12.8, with its own review).

## Anomaly flags (`backend/src/ml/anomaly.ts`)

Unsupervised screening: a robust z-score of the provider's forecast error per zone
(|e − median| / (1.4826·MAD) > 3.5), only for zones with at least 30 rows. There are no labelled
anomalies, so this is not a validated detector and no accuracy is claimed for it. Every report and the
Results page state that flags are **not confirmed provider failures or data errors**.

## Running

```bash
cd backend && npm run build
npm run ml -- --data ../../CarbonRoute-AS-data/em-collection
```

Results are written outside the repository (default `../CarbonRoute-AS-data/ml-results`) and shown on
the Results page (`GET /api/results/ml`).

## Status on the collected data (2026-11-13)

First real run (4 hourly collection runs, 5 zones): **insufficient-data**. 50 forecast/realized pairs
(16 measured), spanning 0.13 days with lead times 0–3 h; chronological split 15 / 3 / 4. No model
was fitted. Descriptively, the provider's forecast error over those pairs was MAE 20.18 gCO2eq/kWh
(14.69 against measured values only, n = 16); these numbers are too few to generalise.

Collecting hourly, the training thresholds are reachable after roughly 7 days. The Electricity Maps
trial key expires around 26–27 November 2026, and the plan only exposes the last 24 h of history, so
collection must continue without gaps until then.

## How the pipeline itself was validated

On **synthetic test fixtures** (seeded, clearly separated from real data, never reported as results):

- with a lead-dependent forecast bias, the candidate is promoted and beats every baseline;
- when the truth is unpredictable and the forecast is unbiased noise, the candidate is **not**
  promoted;
- features never use information from after the fetch time; splits never overlap;
- with collection-sized data, nothing is fitted.

While writing these tests, a too-easy fixture (a perfectly periodic "truth") let the model look good
for the wrong reason, and the first honest fixture showed the candidate lacked zone × lead terms.
Both were corrected before this document was written.

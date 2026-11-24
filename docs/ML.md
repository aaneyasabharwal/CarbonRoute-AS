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

## Latest result (2026-11-24 22:26 UTC, interim)

Status: **evaluated-not-promoted**. A model was fitted and evaluated; it did not beat the provider
forecast, so it is not promoted (and the scheduler never uses it in any case).

- Data: 6,880 forecast/realized pairs (4,346 measured), zones DE, FR, GB, IN-NO, US-CAL-CISO,
  11.36 days, lead 0–24 h. Chronological split train 4,365 / validation 405 / test 801
  (1,309 dropped by the leakage gap). Commit a487c47, dataset hash 0713ffc55f0d.
- Test period (held out), gCO2eq/kWh:

  | Model | MAE | RMSE | Bias | MAE measured only (n = 531) |
  |---|---|---|---|---|
  | provider-as-is | 20.82 | 34.19 | −19.85 | 22.45 |
  | bias-corrected | 23.64 | 29.71 | −22.77 | 21.00 |
  | persistence | 63.22 | 103.66 | −16.16 | 44.45 |
  | ridge-error-correction | 20.82 | 27.67 | −18.01 | 19.16 |

- Why not promoted: test MAE is 100.0 % of the best baseline (≤ 95 % required); only 18 independent
  target hours in the test period (≥ 30 required); the 95 % cluster-bootstrap interval of the paired
  difference, [−1.33, 1.82], includes 0.
- Reading: the model ties the provider on MAE and has a lower RMSE and lower measured-only MAE, but
  with 18 test hours these differences are not statistically supported. No improvement is claimed.
- Interim: collection continues until about 2026-11-26 22:00 UTC; the final run will replace this
  section. Files: `results/published/ml-results/ml-2026-11-24T22-26-34-088Z.{json,md}`.

## Status on the collected data (2026-11-13)

First real run (4 hourly collection runs, 5 zones): **insufficient-data**. 50 forecast/realized pairs
(16 measured), spanning 0.13 days with lead times 0–3 h; chronological split 15 / 3 / 4. No model
was fitted. Descriptively, the provider's forecast error over those pairs was MAE 20.18 gCO2eq/kWh
(14.69 against measured values only, n = 16); these numbers are too few to generalise.

Collecting hourly, the training thresholds are reachable after roughly 7 days. The Electricity Maps
trial key expires around 26–27 November 2026, and the plan only exposes the last 24 h of history, so
collection must continue without gaps until then.

Latest run (2026-11-13 19:23 UTC, 6 collection runs): still **insufficient-data**. 105 pairs
(46 measured) over 0.21 days, lead 0–5 h; split 30 / 2 / 7. No model was fitted. Provider forecast
error over all pairs MAE 23.44 (17.41 against measured values only, n = 46). Collection status and
restart instructions: [COLLECTOR.md](COLLECTOR.md).

Run of 2026-11-13 23:48 UTC (12 collection runs): still **insufficient-data**. 350 pairs (175
measured) over 0.40 days, lead 0–10 h; split 140 / 9 / 21 (180 dropped by the leakage gap). No model
was fitted. At hourly collection the thresholds are expected to be reachable after about 7 days.

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

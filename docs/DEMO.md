# Demonstration guide

Two demonstrations, both on real data. Each value they show is labelled with where it comes from:

| Label | Meaning |
|---|---|
| **live** | Fetched from Electricity Maps during the demo |
| **real-forecast** | A provider forecast, as fetched at the time (live or collected) |
| **measured** | Realized intensity the provider marks as measured |
| **provider-estimate** | Realized intensity the provider marks as estimated (not a measurement) |
| **assumed-energy** | Emissions from the energy model (0.125 kW per vCPU); never measured |
| **synthetic** | Generated: benchmark workloads, or the demo trace (demo mode only) |

## A. Reproducible demo on collected data (no API key needed)

Uses the files written by the collector ([COLLECTOR.md](COLLECTOR.md)); makes no provider calls and
reads no secrets.

```bash
cd backend
npm ci && npm run build
npm run demo -- --data ../../CarbonRoute-AS-data/em-collection
```

Options: `--zone DE` (default: the zone with the most measured values), `--out <folder>` (default:
`../CarbonRoute-AS-data/demo-runs/demo-<timestamp>`). The output folder gets `demo-summary.md`,
`demo-result.json`, `demo-job-report.html` and its own scheduling store, so no database is changed.
Running it twice on the same files gives identical output (tested).

What it does, through the same code the API uses:

1. **Job submission and scheduling.** Takes the newest collected forecast snapshot whose job window
   has since been observed, and schedules a 2 h, 2 vCPU job (3 h slack, τ = 0.1, declared runtime
   CV 0.1) with `scheduleWorkflow` exactly as `POST /api/schedule` would at that time.
2. **Explanation and policy comparison.** The stored explanation and the five policies' windows,
   forecast intensities, model deadline-miss risks and assumed-energy emissions; cost-aware and oracle
   shown as unavailable with their reasons.
3. **Infeasible case.** The same job with no slack, CV 0.3 and τ = 0.05: an explicit `INFEASIBLE_RISK`
   decision, no fallback.
4. **After the window.** `collectObservations` with the history the collector stored later, then
   `evaluateJob`: realized values (each labelled measured / provider-estimate), forecast vs realized
   for the recommended and Immediate windows, the offline oracle, and the HTML report.
5. **Benchmark** on all collected data (real forecasts, synthetic workloads) and **forecast-error
   model** status, which is `insufficient-data` until 7 days are collected: no model is fitted and no
   model accuracy is shown.

### Output on the data collected so far (2026-11-13, 6 hourly runs, commit of this PR)

US-CAL-CISO, forecast fetched 13:32 UTC, realized values from the 18:32 UTC collection:

- Recommended (CarbonRoute) 15:00–17:00 UTC, forecast 197.0 gCO2eq/kWh. The lowest-forecast window
  (16:00–18:00, 149.5) was rejected: with the deadline rounded down to whole forecast hours it has
  zero slack, so its modelled miss risk is 50 % > τ.
- Realized (measured): recommended window 230.5, Immediate window (13:32–15:32) 303.8 gCO2eq/kWh.
  One job on one afternoon: an example of the workflow, **not evidence of a saving**.
- Infeasible case: `INFEASIBLE_RISK` (lowest risk among windows 50 %).
- Oracle: unavailable (only the scheduled and Immediate windows were observed for this job).
- Model: `insufficient-data` (105 pairs over 0.21 days).

## B. Live demonstration in the application (Electricity Maps key required)

1. Configure `.env` (see [ENVIRONMENT.md](ENVIRONMENT.md)): `ELECTRICITY_MAPS_API_KEY`, and for a fresh
   database `ADMIN_PASSWORD`. Create a non-admin demo account:
   ```bash
   cd backend && npm run build
   NEW_USER_USERNAME=demo NEW_USER_EMAIL=demo@example.org NEW_USER_PASSWORD='<choose one>' npm run user:create
   ```
2. Start the backend (`npm run dev` in `backend/`, port 5000) and the frontend (`npm run dev` in
   `frontend/`, port 5173). Sign in.
3. **Prototype** page: choose "Live Electricity Maps API", a zone, duration, deadline, risk tolerance and
   runtime variability; schedule. The page shows the **live** forecast (no uncertainty band: the
   provider gives none), the decision explanation, and the policy comparison.
4. **Dispatch.** Without a Kubernetes cluster the execution is labelled *simulated* (no workload runs).
5. **My Jobs** page: the job, its decision and status. After the recommended window has ended (and
   within 24 h), click **Collect observations**; then **Download report**.
6. **Results** page: the stored benchmark runs (with snapshot-cluster intervals and pending counts) and
   the latest model evaluation (`insufficient-data` until enough data exists).

Each live scheduling request spends one provider call; the server-wide budget is enforced.

## What the demos do not show

- Measured energy or realized emissions (no energy measurement exists).
- Automatic start at the recommended time (dispatch is manual).
- Real workload executions unless a Kubernetes cluster is connected.
- Any trained model or model accuracy (insufficient data).
- Statistically supported carbon savings (hours of data from one day; see
  [RESEARCH_SUMMARY.md](RESEARCH_SUMMARY.md)).

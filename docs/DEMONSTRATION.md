# Demonstration package

Public site: **https://aaneyasabharwal.github.io/CarbonRoute-AS/** (GitHub Pages) or
**https://carbonroute-staging-web.onrender.com** (Render); both use the API
**https://carbonroute-staging-api.onrender.com** (Render Free, ₹0) and share accounts and jobs.
Screenshots: `docs/screenshots/`.

## 1. Before the demonstration (10 minutes)

1. **Wake the backend**: open the site about a minute early. The free backend sleeps after 15
   minutes without traffic; the site shows "Connecting to the backend…" until it is ready.
2. **Sign in as the administrator** (Sign in, top right; the username and password set in Render as
   `ADMIN_USERNAME` / `ADMIN_PASSWORD`). The free backend starts with an empty database after every
   restart; only this admin is re-created.
3. **Create demo accounts** on the Account page (e.g. one `student` and one `evaluator`, 12+
   character passwords). Do this shortly before the session: a restart or 15 idle minutes erases them.
4. Keep the site in use during the session (any page load keeps it awake).

## 2. Demonstration sequence (about 15 minutes)

| Step | Page | Show | What to say |
|---|---|---|---|
| 1 | Home → How It Works | the problem and pipeline | Batch jobs are flexible in time; grid carbon intensity varies by hour and place; forecasts are uncertain and jobs have deadlines. |
| 2 | Dashboard | provider and execution status, latest benchmark, model status | Every number comes from the backend. "Not configured" means this free demo has no Electricity Maps key: it uses labelled synthetic data. |
| 3 | Scheduler → zone selector | search "kenya", "south america", "IN-NO"; continent and availability filters | 351 real grid zones from the Electricity Maps catalogue, every one selectable. The panel separates: in the catalogue, listed by the provider, **verified** live (7 zones), own synthetic demo profile (4). KE has no own profile, so demo scheduling uses the generic synthetic trace, and the page says "not KE data"; nothing is silently substituted. |
| 4 | Scheduler → schedule | choose **DE**, preset "1. Controlled Benchmark Demo", runtime CV 0.2, press **Evaluate 5 Schedulers** | Nothing is scheduled until you press it. The forecast is labelled synthetic. |
| 5 | Scheduler → results | candidate windows, policy comparison, recommendation, explanation | Immediate and EDF start now; Greedy picks the lowest forecast ignoring risk; CarbonAware uses a fixed buffer; CarbonRoute picks the lowest forecast whose deadline-miss probability is within τ. The explanation quotes the binding constraint. |
| 6 | Scheduler → dispatch | **Dispatch** | Labelled "Simulated execution: no workload process is run". A second dispatch is refused. |
| 7 | My Jobs | the job, its decision, report | Jobs belong to their owner (another student gets 404). Report as HTML/JSON. |
| 8 | Results | latest benchmark (1 day of real data) | Real forecasts and realized values, synthetic workloads, 95 % snapshot-cluster intervals. CarbonRoute vs Immediate at CV 0.2: −25.2 gCO2eq/kWh, simulated violations 0.8 % vs Greedy 20 %. **Not statistically conclusive** (1 day < 7). No model trained (insufficient data). |
| 9 | Experiments | metric status | Each metric marked implemented, qualified or planned; no number on that page is a result. |
| 10 | Account | password change, admin account list | Changing a password signs out every other session. |
| 11 | (optional) resize the window | navigation | Responsive navigation: 5 app links + "More"; a menu below 1024 px. |

Optional contrasts: choose **US-TEX-ERCO** (demo profile, America/Chicago) or **IN-NO** (Asia/Kolkata)
to show time-zone handling; with runtime CV 0.2, set the deadline equal to the duration (the slider
minimum): zero slack means a 50 % miss risk > τ, so the result is an explicit **infeasible** decision
(no recommendation is invented).

## 3. Sample demo jobs

| Preset / settings | Zone (demo) | Expected behaviour |
|---|---|---|
| 1. Controlled Benchmark Demo, CV 0 | BENCHMARK-RESEARCH | deterministic runtime: CarbonRoute = Greedy |
| 1. Controlled Benchmark Demo, CV 0.2 | DE | CarbonRoute may choose a less clean but safer window than Greedy |
| 2. Data Pipeline | US-TEX-ERCO | local times in America/Chicago |
| 3. Nightly Backup | IN-NO | local times in Asia/Kolkata |
| any, CV 0.2, deadline = duration (slider minimum) | any demo zone | INFEASIBLE with the reason (risk above τ) |
| CV 0.2, deadline in 4–10 h | KE or MW (no own profile) | schedules on the generic synthetic trace, labelled "not KE/MW data"; CarbonRoute avoids the risky last window |

## 4. Explaining the model to faculty

- **Decision variable**: the start slot *t* of a job of duration *d* hours between its arrival *a*
  and its deadline *D* (exact instants, UTC).
- **Objective**: minimise the forecast carbon intensity averaged over the run window.
- **Constraint (CarbonRoute)**: deadline-miss probability ≤ τ, with runtime R ~ Normal(d, (cv·d)²):
  P(miss) = 1 − Φ((D − t − d)/(cv·d)). cv is *declared* by the user (not learned); with cv = 0 the
  constraint reduces to "ends by the deadline".
- **Why uncertainty matters**: the cleanest window is often the latest one; a late start leaves no
  slack for a run that takes longer than planned. Greedy ignores this (20 % simulated violations in
  the latest benchmark); CarbonRoute trades a little intensity for meeting τ (0.8 %).
- **Forecast uncertainty**: the provider gives none, so none is invented; forecast error is measured
  against realized values (MAE, RMSE, bias by lead time) in the research pipeline.
- **Evaluation**: replay on real forecast snapshots and realized values; every policy sees the same
  synthetic workloads; paired difference vs Immediate with a cluster bootstrap over snapshots;
  conclusive only with ≥ 7 days and ≥ 30 clusters.
- **Emissions** = energy (kWh) × intensity (gCO2eq/kWh); energy is an assumption (0.125 kW per
  vCPU), so emissions are labelled estimates, never measured savings.

Details: [SCHEDULING_METHODOLOGY.md](SCHEDULING_METHODOLOGY.md), [RESEARCH_REPORT.md](RESEARCH_REPORT.md).

## 5. If something goes wrong

| Symptom | Cause | Action |
|---|---|---|
| "Connecting to the backend…" | free backend waking | wait up to a minute |
| Signed out unexpectedly / account missing | backend restarted (free plan, no persistence) | sign in as admin, recreate demo accounts |
| "Backend not reachable" after 2 minutes | Render outage or free hours exhausted | use the local demo (README: Running locally) |
| Live data unavailable | no key on the free demo, by design | use demo data; live data works locally with a key |

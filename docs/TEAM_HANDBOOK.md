# CarbonRoute team handbook

Everything a team member needs to understand, present, defend and run CarbonRoute, in one place.
State as of 15 November 2026. Where a topic has a detailed document, it is named in *(see …)*;
this handbook alone is enough for the presentation and viva.

---

## 1. Quick facts

| | |
|---|---|
| Project | **CarbonRoute: uncertainty-aware batch workload scheduling under carbon forecast errors** |
| Course | UCS503 Software Engineering (capstone). Supervisor: Sukhpal Singh |
| Team | Team TriFlux: Yuvika Nagpal, Kumkum Gupta, Aaneya Sabharwal |
| Live site (present this) | https://aaneyasabharwal.github.io/CarbonRoute-AS/ |
| Same site on Render | https://carbonroute-staging-web.onrender.com |
| Backend API | https://carbonroute-staging-api.onrender.com (health: `/api/health`) |
| Code | https://github.com/aaneyasabharwal/CarbonRoute-AS (branches `main` and `fix/prototype-flaws`) |
| Hosting cost | ₹0 (Render Free, no card on file; GitHub Pages free) |
| Status | Working research system (not production-ready), publicly deployed; research results **not yet statistically conclusive** |
| Admin login | Held by Aaneya only (never written in any document) |

**Before any demo:** open the site a minute early (the free backend sleeps after 15 idle minutes),
sign in as admin, create the demo accounts. Accounts and jobs are wiped whenever the backend restarts.

---

## 2. The problem and our answer

**Problem.** Flexible batch jobs (model training, data pipelines, backups) usually only need to
finish before a deadline. The carbon intensity of grid electricity (grams of CO2-equivalent per kWh)
changes by hour and by region, so *when* a job runs changes its emissions. Two uncertainties make
"just run it in the cleanest hour" risky:
1. the carbon **forecast** may be wrong;
2. the job may **run longer** than planned, and the cleanest hour is often the latest one, leaving
   no time to spare before the deadline.

**Research question.** How much forecast carbon intensity can a scheduler avoid while keeping the
probability of missing the deadline below a stated tolerance, using real forecasts?

**Our answer (the CarbonRoute policy).** Choose the start time with the lowest forecast carbon
intensity **among the windows whose probability of missing the deadline is at most τ** (default 5%).

**Objectives.**
1. A working platform: submit a job → get a decision with an explanation → dispatch → inspect results.
2. A decision model with an explicit, testable deadline-risk constraint.
3. Global applicability: any of the 351 electricity grid zones in the Electricity Maps catalogue.
4. A reproducible, fair evaluation on real forecasts and realized values.
5. An honest machine-learning extension that only trains when there is enough data.

---

## 3. What a user can do (the product)

1. **Sign in** (accounts are created by the admin; no self-registration).
2. **Scheduler page** (called Prototype before 15 Nov; `/prototype` still redirects): choose a grid zone (351 available), a data source (live or synthetic demo),
   job duration, deadline, risk tolerance τ and runtime variability (CV). Press **Evaluate 5 Schedulers**.
   Nothing is scheduled until that button is pressed.
3. See the **forecast**, every **candidate window** (feasible or rejected, with its risk), the
   **comparison of five policies**, the **recommendation** and a written **explanation**.
4. **Dispatch** the job: to Kubernetes if a cluster is connected, otherwise a clearly labelled
   simulation. A job can be dispatched once.
5. **My Jobs:** every job with its decision, explanation, status, cancellation, and a downloadable
   **report** (HTML or JSON). With live data, the **observations** (what the grid actually did) can be
   collected after the run and compared with the forecast.
6. **Dashboard:** provider status, execution mode, your jobs, latest benchmark, model status.
7. **Results:** benchmark results with confidence intervals, forecast accuracy, model status.
8. **Experiments:** the evaluation design; each metric marked implemented, qualified or planned.
9. **Account:** change password (signs out every other session); admins create and list accounts.

---

## 4. Architecture *(see ARCHITECTURE.md, API_SPEC.md)*

```
Browser (React + Vite + TypeScript, Tailwind)
   │  HTTPS / JSON, JWT bearer token
   ▼
Express + TypeScript API (Node 20)
   ├─ auth, accounts, rate limits, CORS, security headers
   ├─ scheduling workflow: snapshot → candidates → 5 policies → explanation → stored decision
   ├─ Electricity Maps v3 client (forecast, history, latest, zones; call budget; quality labels)
   ├─ global zone catalogue (351 zones, static)
   ├─ job lifecycle: jobs, decisions, executions, observations, reports
   ├─ dispatch: kubectl (Kubernetes) or simulation
   └─ JSON-file database + scheduling store
Offline research tools (same codebase): collector → benchmark → ML → research report
```

| Folder | Contents |
|---|---|
| `frontend/` | React app: `src/pages` (one file per page), `src/components` (Navbar, ZoneSelector, panels), `src/services/api.ts` |
| `backend/src/services` | `schedulerService.ts` (engine), `schedulingWorkflow.ts`, `uncertaintyService.ts` (deadline risk), `explain.ts`, `energyModel.ts`, `k8sConnector.ts`, `reportService.ts` |
| `backend/src/carbon` | Electricity Maps client, zone catalogue, time zones, coverage |
| `backend/src/benchmark`, `backend/src/ml` | replay benchmark, forecast accuracy, ML pipeline |
| `backend/src/scripts` | collector, benchmark, ML, research report, demo, user creation |
| `backend/test`, `frontend/test` | automated tests |
| `data/zones/sources` | versioned inputs of the zone catalogue |
| `results/published` | published benchmark, ML status and research report |
| `docs/` | all documentation |
| `render.yaml` | free Render deployment definition |

**Tech stack:** TypeScript everywhere; React 18, Vite, Tailwind; Express; Vitest, Supertest, React
Testing Library; GitHub Actions CI; Docker (images built in CI); Render and GitHub Pages hosting.
A small legacy Python (FastAPI) service has its own tests.

---

## 5. The scheduling model *(see SCHEDULING_METHODOLOGY.md)*

### 5.1 Inputs
- Job: duration *d* (whole hours), deadline *D* (exact instant), arrival *a* (when submitted),
  vCPUs and memory, risk tolerance τ (0 < τ < 1), runtime variability **CV** (declared by the user).
- One forecast snapshot for the zone: hourly carbon intensity in gCO2eq/kWh, up to 72 h ahead.
- All computation is in **UTC**; the zone's time zone is only used to display local times.

### 5.2 Candidate windows
Every hourly start time from the arrival to the last start that can end by the deadline. A window
starting in the arrival hour starts at the exact arrival instant. Windows with a missing forecast
value are rejected (nothing is filled in).

### 5.3 Deadline risk (the core formula)
The real runtime *R* is modelled as Normal(*d*, (CV·*d*)²). For a window starting at *t*:

**P(miss) = P(t + R > D) = 1 − Φ( (D − t − d) / (CV · d) )**

where Φ is the standard normal cumulative distribution. (D − t − d) is the **slack**. With CV = 0
the runtime is exact: risk is 0 if the window ends by the deadline, otherwise 1.
Example: slack 32 minutes, d = 2 h, CV = 0.1 → σ = 12 min → P(miss) = 1 − Φ(32/12) ≈ 0.4%.

CV is **declared, not learned**: we have no recorded real runtimes yet to calibrate it.

### 5.4 The five policies (same snapshot, same candidates)

| Policy | Rule | Role |
|---|---|---|
| Immediate | start at arrival | reference baseline |
| EDF (Earliest Deadline First) | same as Immediate for a single job | baseline |
| Greedy (deterministic carbon) | lowest forecast window that ends by the deadline; ignores runtime risk | shows what ignoring risk costs |
| CarbonAware baseline | earliest window, starting at least a buffer (1–3 h, 25% of slack) before the deadline, whose forecast is at or below the 25th percentile of those windows | simple industry-style heuristic |
| **CarbonRoute** | lowest forecast window with **P(miss) ≤ τ** | our method |
| Oracle (offline only) | best window in hindsight using what actually happened | upper bound for "regret"; not a real scheduler |
| Cost-aware | not available: no electricity price data in our plan | stated as unavailable |

With CV = 0, CarbonRoute and Greedy choose the same window (the risk constraint is then just "ends by
the deadline").

### 5.5 Outputs
Recommended window (start/end in UTC and local time), the comparison of all policies (intensity,
delay, risk), the rejected windows with reasons, and a written **explanation** naming the binding
constraint. If no window satisfies the constraint the decision is **INFEASIBLE** with the reason;
nothing is invented.

### 5.6 Emissions
**Emissions (g) = energy (kWh) × carbon intensity (gCO2eq/kWh).** Energy is an **assumption**:
0.125 kW per requested vCPU (minimum 0.1 kW) × duration. Emissions are therefore always labelled
**estimated**; we never claim measured savings.

---

## 6. Data *(see ELECTRICITY_MAPS.md, COLLECTOR.md)*

- **Provider:** Electricity Maps API v3 (trial key; expires around 26–27 Nov 2026). Lifecycle emission
  factors, hourly granularity. History is limited to the last 24 h by the plan.
- **Quality labels:** realized values are either **measured** or a **provider estimate**; both are kept
  apart and reported.
- **Data kinds:** *forecast* (prediction), *realized* (what happened), *synthetic* (our demo profiles,
  never real), *assumed* (energy model). Every page and report labels which it shows.
- **Collector:** an hourly program that saved, for 5 zones (DE, FR, GB, IN-NO, US-CAL-CISO), the 24 h
  forecast and the last 24 h of realized values. Its approved run finished on 14 Nov 15:32 UTC:
  **25 runs, 250 records, 0 failures**. Hours 08:07–12:32 UTC on 14 Nov were missed (computer asleep).
  It uses an operating-system lock so two collectors can never run at once.
- **Where the data is:** on Aaneya's computer in `CarbonRoute-AS-data/` (next to the repository):
  `em-collection/` (raw files, never edited), `backups/` (verified copies), `snapshots/` (frozen
  inputs of experiments), `benchmark-results/`, `ml-results/`, `reports/`. Published copies of results
  are in the repository under `results/published/`.

---

## 7. Global zones *(see GLOBAL_ZONES.md)*

- The app supports **all 351 Electricity Maps zones** in **207 countries** on five continents
  (Africa 56, Americas 121, Asia 71, Europe 80, Oceania 23). The original prototype had 4.
- Built reproducibly from: the provider's public zone list, its open-source zone configuration
  (time zone and region), the IANA time-zone database and UN M49 regions. CI checks it rebuilds
  identically.
- **346 zones** have an IANA time zone. Seven wrong time zones in the provider's configuration were
  corrected (e.g. Bosnia was listed as Asia/Bahrain). Five multi-time-zone countries' aggregates
  (US, CA, BR, AU, MY) are deliberately left in UTC.
- **Availability levels, kept separate:**

| Level | Zones | Meaning |
|---|---|---|
| In the catalogue | 351 | the zone exists |
| Listed by the provider for our trial key | 351 | the provider *says* forecast/history are available (a listing is not proof) |
| Live data verified | 7 (DE, FR, GB, IN, IN-NO, IN-SO, US-CAL-CISO) | we actually read data with our key |
| Own synthetic demo profile | 4 (DE, IN-NO, US-CAL-CISO, US-TEX-ERCO) + research benchmark | zone-specific fake data for the public demo |
| Demo scheduling possible | **all 351** | the other 347 use the **generic synthetic trace**: one synthetic curve shared by all of them, labelled "not <zone> data" |

- The selector lets you search by name, zone id, country, continent or area, and filter by continent
  and availability. In demo mode **every zone can be scheduled**; zones without their own profile use
  the generic synthetic trace, and the forecast title and panel say "not <zone> data". In live mode a zone the
  server cannot serve stays selected, Evaluate is disabled and the reason is shown. **Nothing is ever
  silently substituted.**

---

## 8. Experiments and results *(see RESEARCH_REPORT.md, EXPERIMENTS.md)*

### 8.1 Setup
- **Replay benchmark:** for each real forecast snapshot, 20 synthetic jobs (seed 42) with durations
  1, 2, 3, 4 h, slack up to 12 h, 2 vCPU. Every policy schedules the **same** jobs on the **same**
  forecast; we then look up what the grid **actually** did in the chosen window.
- Scenarios: runtime CV 0 and 0.2; τ = 0.05.
- **Metrics:** mean realized carbon intensity; difference vs Immediate with a 95% **cluster
  bootstrap** confidence interval over forecast snapshots (2,000 iterations); mean delay; simulated
  deadline-violation rate; regret vs the oracle; estimated emissions.
- **Guardrails** (automatic): a difference is only called "lower/higher" if its interval excludes 0;
  less than **7 days** or fewer than **30 snapshot clusters** → "not statistically conclusive".
- Input: frozen snapshot of 14 Nov 14:40 UTC: 115 forecast snapshots, **1.00 day**, 240 realized
  hourly values (65.8% measured). Running it twice gives identical results.

### 8.2 Results, runtime CV 0.2 (the realistic case)

| Policy | Δ vs Immediate, gCO2eq/kWh [95% CI] | Mean delay | Simulated deadline misses | Regret vs oracle |
|---|---|---|---|---|
| Immediate / EDF | reference | 0 h | 4.2% | 32.61 |
| Greedy | −27.91 [−37.49, −18.94] | 3.17 h | **20.0%** | 3.05 |
| CarbonAware baseline | −15.80 [−21.90, −10.07] | 1.47 h | 4.7% | 16.45 |
| **CarbonRoute** | **−25.16 [−33.60, −16.86]** | 2.80 h | **0.8%** | 10.04 |

With CV 0 (exact runtimes) Greedy and CarbonRoute coincide: −27.9 gCO2eq/kWh, 0 misses.

**How to read it:** in this one-day sample CarbonRoute kept most of Greedy's reduction in carbon
intensity while missing far fewer deadlines (0.8% vs 20%). That is exactly what the risk constraint
is for. **It is not statistically conclusive**: one day is one daily cycle; neighbouring snapshots are
correlated; violations come from a declared runtime model; emissions use assumed energy. An earlier
0.4-day sample showed *no* evidence of a difference, which shows how unstable short samples are.

### 8.3 Forecast accuracy (forecast − realized, 1,655 pairs)

| Zone | MAE | RMSE | Bias |
|---|---|---|---|
| All | 22.7 | 28.9 | +5.6 |
| FR | 8.7 | 9.1 | +5.0 |
| US-CAL-CISO | 17.1 | 21.0 | +2.7 |
| IN-NO | 23.0 | 26.3 | +22.8 |
| DE | 30.8 | 37.4 | +30.7 |
| GB | 34.1 | 39.6 | −33.0 |

(gCO2eq/kWh; positive bias = forecast too high.) Errors differ by zone and are partly systematic,
which is why forecast uncertainty matters.

---

## 9. Machine learning *(see ML.md)*

- **Goal:** learn to predict the forecast's error (to correct it or estimate uncertainty).
- **Pipeline:** features only from information available when the forecast was made (leakage-checked),
  chronological train/validation/test splits with gaps, baselines (no correction, mean bias), a ridge
  regression candidate, and a **promotion rule fixed before evaluation**.
- **Thresholds:** at least 500 / 100 / 200 train / validation / test rows over at least 7 days.
- **Status: insufficient data.** 1,655 pairs over 1 day; split 415 / 55 / 104. **No model was trained.**
  This is deliberate: an honest untrained pipeline is better than a model trained on one day.

---

## 10. Security and accounts *(see SECURITY.md)*

- Passwords hashed with bcrypt; minimum 12 characters; known leaked values refused.
- JWT sessions (HS256, 12-hour lifetime), revocable; logout and password change invalidate tokens.
- Roles: admin, student, evaluator. Admin-only account creation; no public registration.
- Every job is visible only to its owner (others get 404); admins can see all.
- Rate limits on login, job actions, live data and public endpoints; a server-wide provider call budget.
- CORS allows only our two websites; security headers (CSP) on every response.
- Input validation (workloads, zones, dates); Kubernetes manifests built safely (no shell injection).
- Unexpected errors return a generic message with a reference id; details only in server logs.
- No secrets in code, logs or the website bundle; the original prototype's hard-coded admin password
  and JWT secret were removed (they remain in old Git history, so the old service that used them is
  suspended and the new deployment uses freshly generated secrets).

---

## 11. Deployment and operations *(see STAGING.md, HANDOVER.md)*

| Part | Where | Built from |
|---|---|---|
| Website | GitHub Pages: aaneyasabharwal.github.io/CarbonRoute-AS | `main` (automatic on change) |
| Website (copy) | Render static site: carbonroute-staging-web.onrender.com | `fix/prototype-flaws` (Manual Deploy) |
| Backend | Render Free web service: carbonroute-staging-api.onrender.com | `fix/prototype-flaws` (Manual Deploy) |

- Both websites use the **same backend**, so accounts and jobs are shared.
- **Free plan behaviour:** the backend sleeps after 15 minutes without traffic and takes about a minute
  to wake (the site shows "Connecting to the backend…"); it keeps **no data** across restarts; only
  the admin is recreated from its stored password.
- **No live data on the public site** (no provider key, by design, to protect the research quota).
- **Settings:** `VITE_API_URL` (GitHub repository variable) = the Render API; the backend's
  `CORS_ORIGIN` lists both websites. Secrets live only in Render.
- **Deploying a change:** merge it into `fix/prototype-flaws` and `main`; GitHub Pages deploys itself;
  on Render use *Manual Deploy › Deploy latest commit* for the API, then the static site.
- **Checking a deployment:** `scripts/staging-check.mjs` (22 automated checks; admin password typed
  privately).
- The original 2026 backend (`carbonroute.onrender.com`) ran insecure old code; it is **suspended** and
  must never be reused.

---

## 12. Testing and quality

| Gate | Result |
|---|---|
| Backend tests | 341 (26 files) |
| Frontend tests | 134 (18 files) |
| Python tests | 5 |
| Expected-failure tests (`it.fails`) | 12, counted separately: they encode the original prototype's wrong checks, so if that behaviour ever returned they would start passing and flag it |
| CI on every change | backend, frontend, Python, Docker build + smoke test, collector-lock stress test, zone-catalogue rebuild check: all green |
| Browser checks | all 16 pages at 1920, 1440, 1366, 1024, 768 and 390 px wide: no horizontal overflow, nothing cut off, no console errors |
| Public deployment checks | health, CORS, security headers, authentication, catalogue, no region substitution, no secrets in the bundle; signed-in flows 22/22 |

---

## 13. Original prototype vs final *(see ORIGINAL_VS_FINAL.md)*

| Area | Original (Sept 2026) | Final (Nov 2026) |
|---|---|---|
| Regions | 4 hard-coded | 351 zones, honest availability |
| Risk model | mixed carbon σ (gCO2/kWh) with runtime σ (hours): dimensionally wrong; invented σ = 20 | runtime-only, exact instants, explicit formula |
| Uncertainty | invented and shown as real | none invented; forecast error measured |
| Data failures | silently fell back to synthetic data | explicit errors, never substituted |
| Security | admin password and JWT secret committed in the repo | hashed, required secrets, roles, rate limits, CORS, CSP |
| Results | "pending" | reproducible benchmark with confidence intervals and guardrails |
| ML | none | pre-registered pipeline (correctly untrained) |
| Tests / CI | 4 ad-hoc scripts, no CI | 480 automated tests, CI with 4 jobs |
| Code size | 53 source files | 152 source files |
| Deployment | a backend running old code | free public deployment, ₹0 |

---

## 14. Limitations (state them yourself before you are asked)

1. **Only 1 day of real data**: no result is statistically conclusive (needs ≥ 7 days).
2. **No trained ML model** (insufficient data).
3. **Runtime variability is declared**, not calibrated; deadline violations are **simulated**.
4. **Energy is assumed** (0.125 kW/vCPU): emissions are estimates.
5. **Public demo:** synthetic data only, no persistence, cold starts.
6. **Execution is simulated** unless a Kubernetes cluster is connected (never run on a real cluster).
7. Live data **verified for 7 of 351 zones**.
8. Forecast-error bands are measured but **not used in decisions**.
9. **No cost-aware policy** (no price data).
10. JSON-file storage, single instance; session token in browser storage (12 h).

---

## 15. What we must not claim

- ✗ "CarbonRoute reduces emissions by X%." → ✓ "In a one-day replay sample, CarbonRoute's windows had
  25 gCO2eq/kWh lower realized carbon intensity than starting immediately; not yet conclusive."
- ✗ "Measured carbon savings." → ✓ "Estimated emissions with an assumed energy model."
- ✗ "We trained an ML model." → ✓ "The pipeline is built; it correctly refuses to train on one day."
- ✗ "Live data for 351 zones." → ✓ "351 zones selectable; live data verified for 7."
- ✗ "Calibrated uncertainty." → ✓ "Declared runtime variability; forecast error measured."
- ✗ "Runs on Kubernetes." → ✓ "Kubernetes submission is implemented and unit-tested; the demo simulates execution."
- ✗ Presenting synthetic demo numbers as real data.

---

## 16. Demonstration *(full script: DEMONSTRATION.md)*

**Preparation (10 min before):** open the site, wait for it to connect, sign in as admin, create one
student and one evaluator account on the Account page.

**Sequence (about 15 min):**
1. Home / How It Works: the problem.
2. Dashboard: everything comes from the backend; "not configured" = synthetic data on the free demo.
3. Scheduler → zone selector: search "kenya", "south america"; show the availability panel. KE has no
   own demo profile, so it runs on the generic synthetic trace, which the page labels "not KE data".
4. On the Scheduler choose **DE**, preset "Controlled Benchmark Demo", CV 0.2 → **Evaluate 5 Schedulers**.
5. Walk through the candidate windows, the five policies, the recommendation and the explanation.
6. **Dispatch** → labelled simulated; a second dispatch is refused.
7. My Jobs → the job, its report.
8. Results → the benchmark table; say "not statistically conclusive" and "no model trained".
9. Experiments → metric status. Account → password change.
10. Optional: CV 0.2 with deadline = duration → **INFEASIBLE** with the reason; resize the window to
    show the responsive navigation.

**If something goes wrong:** "Connecting…" → wait a minute. Account missing → backend restarted; sign
in as admin and recreate it. Backend unreachable after 2 minutes → run the app locally (§18).

---

## 17. Likely viva questions and answers

**What is new compared with simple carbon-aware scheduling?** An explicit, quantified deadline-risk
constraint: we only move a job to a cleaner hour if the probability of missing the deadline stays
below τ, and we compare against Greedy on identical inputs.

**Why model the runtime as a normal distribution?** It is the simplest model with one interpretable
parameter (CV) and gives a closed-form risk. Its limitation is that CV is declared; with recorded
runtimes we would fit it, or use an empirical distribution.

**Why not include forecast uncertainty in the risk?** Deadline risk depends on runtime, not on
carbon. Forecast error affects *which* window is cleanest; we measure it (MAE/RMSE/bias by lead time)
but do not yet have enough data to use error bands in decisions.

**Is the result significant?** No. One day of data; our own rule requires at least 7 days and 30
snapshot clusters. The confidence interval excludes zero in this sample, but short samples are
unstable (the 0.4-day sample did not).

**Why a cluster bootstrap?** All jobs scheduled on the same forecast snapshot share its errors, so
they are not independent; resampling whole snapshots gives honest intervals.

**How do you avoid future-data leakage?** Policies only see the forecast snapshot; realized values are
used only to score afterwards. The oracle, which uses them, is offline-only and labelled so. The ML
features use only information available when the forecast was made (tested).

**Why no trained model?** The thresholds (500/100/200 rows over 7 days) were fixed before evaluation;
we have 1 day. Training anyway would be overfitting presented as a result.

**How are emissions computed?** Energy × carbon intensity, with energy assumed at 0.125 kW per vCPU;
so we report intensity differences and estimated emissions, not measured savings.

**What does "351 zones" mean if live data is not verified for all?** Every zone is in the catalogue
and selectable; the provider lists forecasts for all of them under our key, but we only claim what we
actually read (7). The UI shows these levels separately.

**What happens with daylight-saving time?** Nothing changes for scheduling: all windows are UTC hours.
Local times are only for display (tested on the US Pacific change of 1 Nov 2026).

**What if the deadline cannot be met?** The decision is INFEASIBLE with the reason; no window is
invented.

**Is it secure?** Hashed passwords, 12-hour revocable sessions, ownership checks, rate limits, CORS,
CSP, validated inputs, no secrets in code; covered by automated security tests.

**How much does it cost to run?** ₹0 on free tiers, with the stated limits (sleep, no persistence).

**What would you do next?** Collect ≥ 7 days and re-run; train the model under the fixed rule; record
real runtimes to calibrate CV; measure energy on real executions; add price data for a cost-aware
policy; persistent production hosting.

---

## 18. Running it locally

Requirements: Node.js 20 (24 works), npm; optional Python 3.12.

```bash
cp .env.example .env          # fill in values (docs/ENVIRONMENT.md); never commit .env
cd backend && npm ci && npm run build && cd ..
cd frontend && npm ci && cd ..
cd backend && npm run dev     # API on http://localhost:5000
cd frontend && npm run dev    # app on http://localhost:5173
```

Create an account: in `backend/`, set `NEW_USER_USERNAME`, `NEW_USER_EMAIL`, `NEW_USER_PASSWORD`
(and `NEW_USER_ROLE=admin` for an admin), then `npm run user:create`. Live data needs
`ELECTRICITY_MAPS_API_KEY` in `.env`. Tests: `npm test` in `backend/` and `frontend/`.

---

## 19. Glossary

- **Aggregate zone:** a zone made of sub-zones (e.g. `US`, `IN`).
- **Arrival:** when the job is submitted. **Deadline:** latest finish time.
- **Carbon intensity:** gCO2eq per kWh of grid electricity.
- **Cluster bootstrap:** confidence interval by resampling whole forecast snapshots.
- **CV:** coefficient of variation of runtime (standard deviation ÷ planned duration).
- **Dispatch:** sending a scheduled job to run (Kubernetes or simulation).
- **EDF:** Earliest Deadline First.
- **Forecast snapshot:** one forecast as issued at one time, stored with its provenance.
- **Infeasible:** no window satisfies the deadline and risk tolerance.
- **Lead time:** how far ahead a forecast value is.
- **MAE / RMSE / bias:** mean absolute error / root mean squared error / mean signed error.
- **Measured vs estimated:** realized values the provider measured vs estimated.
- **Oracle / regret:** best choice in hindsight / how much worse a policy did than it.
- **Realized value:** what the grid actually did in an hour.
- **Slack:** time to spare: deadline − start − duration.
- **Synthetic:** generated demo data, never real.
- **τ (tau):** maximum accepted probability of missing the deadline.
- **Zone:** an electricity grid area (country or region) in the Electricity Maps catalogue.

---

## 20. Document map

| Document | Read it for |
|---|---|
| **TEAM_HANDBOOK.md** (this) | everything, in one place |
| HANDOVER.md | final state, links, hosting, data locations, next steps |
| DEMONSTRATION.md | demo script and faculty explanations |
| RESEARCH_REPORT.md | paper-style research write-up |
| ORIGINAL_VS_FINAL.md | detailed comparison and ranked open problems |
| VALIDATION_REPORT.md | every verification result |
| SCHEDULING_METHODOLOGY.md | the exact model |
| GLOBAL_ZONES.md | the zone catalogue |
| EXPERIMENTS.md, ML.md, RESEARCH_SUMMARY.md | research details |
| ARCHITECTURE.md, API_SPEC.md, SECURITY.md, TESTING.md | system details |
| STAGING.md, ENVIRONMENT.md, DEPLOYMENT.md, COLLECTOR.md | operations |
| FINAL_REPORT.md, SPRINT_PROGRESS.md, DEPLOYMENT_READINESS.md, DEMO.md | history only |
| PROTOTYPE_DEMO.md, PROTOTYPE_IMPLEMENTATION.md | original prototype (superseded; do not present) |
| docs/screenshots/ | images for slides and the report |

---

## 21. Open decisions and tasks for the team

1. Agree who presents which part (suggested: problem and model; live demo; results and limitations).
2. Practise the demonstration once end to end on the live site.
3. Decide whether to collect 7 more days of data before the trial key expires (~26–27 Nov); the
   computer must stay awake; then re-run the benchmark and ML on a frozen snapshot.
4. Add a short literature review with real citations (the research report has none by design).
5. Keep the admin password private; share demo account passwords privately, never in chat or slides.

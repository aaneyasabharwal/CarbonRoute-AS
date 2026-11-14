# Final validation report (2026-11-14)

Branch `fix/prototype-flaws` after PR #27 (`2152b01`) plus the final documentation PR. Every result
below was produced and checked on 2026-11-14; nothing is carried over unverified.

## 1. Automated tests, typechecks, builds, CI

| Gate | Result |
|---|---|
| Backend typecheck (source + tests) | pass |
| Backend tests | **341 passed in 26 files**; of these, 11 are `it.fails` (original prototype checks that must keep failing) |
| Backend build | pass |
| Frontend typecheck | pass |
| Frontend tests | **134 passed in 18 files**; of these, 1 is `it.fails` |
| Frontend build; GitHub Pages build | pass; a Pages build **without** `VITE_API_URL` fails by design |
| Python service tests | **5 passed** |
| Zone catalogue reproducible from `data/zones/sources` | pass (CI step; LF and CRLF sources give the identical file) |
| CI on PR #27 (4 jobs: Backend incl. collector-lock stress test and catalogue check, Frontend, Python, Docker build + smoke test) | **8/8 green** (push + pull request) |
| Expected-failure tests in total | **12** (reported separately; never counted as ordinary passes) |

## 2. Global zone catalogue

| Measure | Count |
|---|---|
| Zones in the catalogue (Electricity Maps public list, 2026-11-14) | **351** |
| Countries / continents | 207 / 5 (Africa 56, Americas 121, Asia 71, Europe 80, Oceania 23) |
| Zones with an IANA time zone | 346 (5 multi-time-zone aggregates deliberately unresolved) |
| Forecast / history / latest **listed by the provider** for the trial key | 351 / 351 / 351 (not proof of access) |
| Live data **verified** with the project key | **7** (DE, FR, GB, IN, IN-NO, IN-SO, US-CAL-CISO) |
| **Synthetic demo** profiles | 4 (+ the synthetic research benchmark) |
| Selectable in the UI | 351 (+ benchmark); no limit, no truncation (test with 351 zones; browser check: "Showing 351 of 351 zones") |

## 3. Browser viewport audit

16 pages (Home, Project, How It Works, Architecture, Dashboard, Prototype, My Jobs, Results,
Experiments, System Design, Roadmap, Team, Resources, Planning V1, Account, sign-in) at 100 % zoom,
measured in a real browser: document width vs viewport, every element's right edge, navigation
label wrapping, header height.

| Viewport | Local build (signed in as admin) | Public site (signed out) |
|---|---|---|
| 1920 × 1080 | 0 problems | 0 problems |
| 1440 × 900 | 0 | 0 |
| 1366 × 768 | 0 | 0 |
| 1024 × 768 | 0 | 0 |
| 768 × 1024 | 0 | 0 |
| 390 × 844 | 0 (after fixing the Results run selector, 495 px) | 0 |

Before the fix (public site, 1366 × 768 and 1440 × 900): 4 wrapped navigation labels, 5 items
beyond the viewport (including "Sign in"), document ~1850 px wide. The "More" menu opens inside the
viewport at 1024 px; the < 1024 px menu lists all 14 destinations plus Sign in with ≥ 36 px targets.
No console errors on the public site during the audit.

## 4. Public deployment (Render Free, ₹0, no card on file)

Websites https://aaneyasabharwal.github.io/CarbonRoute-AS/ (GitHub Pages, from `main`) and
https://carbonroute-staging-web.onrender.com (Render) · API https://carbonroute-staging-api.onrender.com

| Check (2026-11-14, after deploying `2152b01`) | Result |
|---|---|
| Billing | Hobby plan, **no card on file**; API on the Free plan; services can only be suspended, never charged |
| `GET /api/health` | 200 |
| CORS: site origin allowed; unknown origin | allowed; no header |
| Security headers (CSP) | present |
| Protected endpoints without a token (`/jobs`, `/results/benchmarks`, live forecast) | 401 |
| Wrong password | 401 |
| `GET /api/carbon/catalogue` | 351 zones, `liveConfigured: false`, 7 verified |
| Demo data for a zone without a profile (KE) | **422** with the reason (no substitution) |
| Public demo forecast | 200, labelled synthetic |
| All site routes and the bundle | 200 |
| Bundle contains the API key value / `JWT_SECRET` / the retired backend host | no / no / no |
| Prototype page on load (signed out) | demo mode, no live request, no scheduling request, no console errors |
| Signed-in flows on the public site (`scripts/staging-check.mjs`, run by the owner on `b36d846`) | **22/22** (sign-in, admin account creation, scheduling with 5 policies and explanation, ownership 404, HTML report, simulated dispatch, second dispatch 409, results, model status, password change, logout) |
| GitHub Pages (after PR #29, `main` `82f36c5`) | Pages workflow succeeded; site and bundle 200; bundle uses the Render API, base path `/CarbonRoute-AS/`, no retired host; CORS allows `https://aaneyasabharwal.github.io`; Dashboard shows backend data; Prototype lists 351 zones; deep links work through `404.html` (reported as HTTP 404 by the browser, all assets 200) |
| Signed-in flows on the new build (`2152b01`) | verified locally in production mode (same commands); a public re-run needs the admin password (owner) |

## 5. Research results (frozen snapshot 2026-11-14 14:40 UTC, dataset `0e9b960c6b21`)

| Item | Result |
|---|---|
| Data | 115 forecast snapshots, 5 zones, 1.00 day; realized values partly provider estimates |
| CarbonRoute vs Immediate, runtime CV 0.2 | −25.16 [−33.60, −16.86] gCO2eq/kWh (113 clusters) |
| Simulated deadline violations (CV 0.2) | CarbonRoute 0.8 %, Immediate 4.2 %, CarbonAware 4.7 %, Greedy 20.0 % |
| Verdict (automatic guardrail) | **Not statistically conclusive** (1 day < 7) |
| Reproducibility | second run, same seed: identical results (except timestamp/commit) |
| ML | **insufficient-data**: 1,655 pairs, split 415/55/104 vs 500/100/200 over ≥ 7 days; **no model trained** |

## 6. Data integrity

- Collector pid 3304 checked read-only only: 24 of 25 runs, 240 records, 0 unparseable, 0 failed;
  the 13 Nov file's SHA-256 (`397ebd6a…`) unchanged; never restarted, edited or truncated.
- Experiments ran on a **copy** (`../CarbonRoute-AS-data/snapshots/collection-2026-11-14T1440Z`);
  published results are new files; earlier results kept.
- No secret in the repository, logs or bundle; `staging-check.state.json` is git-ignored.

## 7. Known limitations

See [ORIGINAL_VS_FINAL.md](ORIGINAL_VS_FINAL.md) §2 (ranked) and [HANDOVER.md](HANDOVER.md) §7.
In short: 1 day of data (not conclusive), no trained model, declared (uncalibrated) runtime
variability, assumed energy, simulated execution, free demo without live data or persistence.

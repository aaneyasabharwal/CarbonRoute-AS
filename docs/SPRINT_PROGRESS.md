# Sprint progress (P8 completion sprint)

Durable log for the autonomous completion sprint that started 2026-11-13 21:36 UTC. Updated after
each milestone. Times are UTC. Claims use: **implemented**, **tested locally**, **verified in CI**,
**verified with real data**, **deployed**, **not implemented**, **not validated**.

Last update: 2026-11-14 00:35.

## Baseline (recovered 2026-11-13 21:36)

| Item | Verified state |
|---|---|
| `fix/prototype-flaws` | `1ba4508` (merge of PR #15); post-merge CI 4/4 green |
| `main` | `80b411a`, untouched (still untouched at the last update) |
| Open PRs at start | none |
| Collector | pid 3304, owns the socket lock (probe start refused) |
| Collected data | 100 records, 10 runs, 0 failures; first 90 lines sha256 `29f7edb8…` |
| Old Render backend | suspended (`503`, `x-render-routing: suspend-by-user`) |

## Pull requests (all target `fix/prototype-flaws`; none merged)

| PR | Branch | Head | Content | CI |
|---|---|---|---|---|
| #16 | `task/p8-security` | `ad1d5bf` | S1–S8: login timing, password change, admin accounts, cluster-status leak, public limits, generic 500s, 1 MB JSON, 12 h tokens, SECURITY.md | 4/4 green |
| #17 | `task/p8-pages-api-url` | `34a4e2c` | B7: no default backend; Pages build requires a valid `VITE_API_URL` | 4/4 green |
| #18 | `task/p8-job-lifecycle` | `6a73078` | L1–L3: persisted execution status, `interrupted`, single dispatch, no dispatch without a recommendation | 4/4 green |
| #19 | `task/p8-scheduling-correctness` | `7e20e0d` | E1: deadline risk from exact deadline and arrival instants | 4/4 green |
| #20 | `task/p8-research-report` | `139ca89` | `npm run report` with guardrails; results on 12 runs | 4/4 green |
| #21 | `task/p8-dashboard` | `9983362` | real Dashboard (D1) | 4/4 green |
| #22 | `task/p8-account-ui` | `02d332f` | Account page, auth-aware navigation (N1); **contains #16 and #21** | 4/4 green |
| (next) | `task/p8-sprint-progress` | this branch | docs: README, ARCHITECTURE, TESTING, FINAL_REPORT §7–8, this log | docs only |

**Merge order:** #16 → #21 → #22 (it contains both); the others are independent and may go in any
order. All seven merge together without conflicts (checked locally).

## Verification of the combined tree (all seven merged locally, 2026-11-13 23:58)

| Gate | Result |
|---|---|
| Backend typecheck / build | pass / pass |
| Backend tests | 329 passed in 24 files (11 `it.fails`, reported separately) |
| Frontend typecheck / build | pass / pass |
| Frontend tests | 116 passed in 13 files |
| Pages build | passes with `VITE_API_URL`; fails without it (by design) |
| Python tests | 5 passed |
| Live end-to-end API check | 30/30 (one real provider call) |

## Defects found and fixed this sprint

S1 login timing · S2 cluster-status leak and spawn cost · S3 public compute limits · S4 exception text
in responses · S7/S8 password change and account management · N1 navigation showed Admin to everyone ·
B7 default to suspended backend · L1 execution status not persisted · L2 duplicate dispatch · L3
dispatch without recommendation · E1 deadline-risk instants · R1 no reproducible report · D1 placeholder
Dashboard · T1 CRLF test failure on Windows. Details in FINAL_REPORT.md §7.

## Real-data results (23:48)

Benchmark on 60 snapshots / 170 realized values (61.2 % measured), 0.40 days: CarbonRoute vs Immediate
at runtime CV 0.2: −7.21 [−17.39, +0.40] gCO2eq/kWh, **no evidence of a difference**; simulated
violations Greedy 23.4 % vs CarbonRoute 0.9 %. ML: insufficient-data (350 pairs; split 140/9/21).
Report: `../CarbonRoute-AS-data/reports/research-report-2026-11-13T23-48-22-308Z.md`.

## Collector

| Time | PID | Runs | Records | Failures | First-90-lines sha256 |
|---|---|---|---|---|---|
| 21:36 | 3304 | 10 | 100 | 0 | `29f7edb8…` |
| 23:39 | 3304 | 12 | 120 | 0 | `29f7edb8…` |
| 00:01 | 3304 | 12 | 120 | 0 | `29f7edb8…` (run 13 due 00:06, first record of the 14 Nov file) |

The collector runs the approved 25-run plan (ends about 2026-11-14 12:50 UTC). Restarting it for the
7-day plan (168 runs) needs the owner's approval (COLLECTOR.md).

## Open blockers (need the owner)

- B3: staging storage option and service creation (possible cost).
- B7 (owner action): set repository variable `VITE_API_URL` once a new backend exists.
- Seven days of data not collected; ML model untrained.
- Review and merge PRs #16–#22 (and the docs PR) into `fix/prototype-flaws`.

## Next action

Open the docs PR for this branch, then continue with remaining audit items (carbon-data handling in
the frontend for unsupported zones, explanation wording), re-checking the collector hourly.

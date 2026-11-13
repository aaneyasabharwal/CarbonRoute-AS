# Sprint progress (P8 completion sprint)

Durable log for the autonomous completion sprint that started 2026-11-13 21:36 UTC. Updated after
each milestone. Times are UTC. Claims use: **implemented**, **tested locally**, **verified in CI**,
**verified with real data**, **deployed**, **not implemented**, **not validated**.

Last update: 2026-11-13 23:40.

## Baseline (recovered 2026-11-13 21:36)

| Item | Verified state |
|---|---|
| `fix/prototype-flaws` | `1ba4508` (merge of PR #15); post-merge CI 4/4 green (Backend incl. lock stress, Frontend, Python, Docker) |
| `main` | `80b411a`, untouched |
| Open PRs | none (PR #15 merged; not to be reopened) |
| Collector | pid 3304 (wrapper delegating to `runCollectorCli`), owns the socket lock on port 26554 (probe start refused) |
| Collected data | 100 records, 10 runs, 0 failures at 21:36; first 90 lines sha256 `29f7edb8…` |
| Old Render backend | suspended (`503`, `x-render-routing: suspend-by-user`) |

## Branches (all from `fix/prototype-flaws` @ `1ba4508`; none merged; independent of each other)

| Branch | Head | Content | Status |
|---|---|---|---|
| `task/p8-security` | `ad1d5bf` | login timing, password change, admin accounts, cluster-status leak + spawn cost, public rate limits, generic 500s, 1 MB JSON limit, 12 h tokens, SECURITY.md | tested locally; **CI 4/4 green** |
| `task/p8-pages-api-url` | `34a4e2c` | B7: no default backend; Pages build requires a valid `VITE_API_URL`; workflows + CI checks | tested locally; **CI 4/4 green** |
| `task/p8-job-lifecycle` | `6a73078` | persisted execution status, `interrupted`, single dispatch, no dispatch without recommendation, lifecycle tests | tested locally; **CI 4/4 green** |
| `task/p8-sprint-progress` | (this file) | progress log | docs only |

The three code branches merge together without conflicts; on the combined tree: backend 315 tests
(11 `it.fails`), frontend 103 tests, both typechecks pass (local check, 23:35).

## Milestones

| # | Milestone | Status |
|---|---|---|
| 0 | Collector lock (PR #15) | complete; verified in CI; lock held by the live collector |
| 1 | Security hardening (S1–S8) | complete on branch; CI green |
| 2 | Deployment blocker B7 (Pages API URL) | code complete on branch; CI green; owner must set repo variable `VITE_API_URL` before deploying |
| 3 | Job lifecycle defects (L1–L3) | complete on branch; CI green |
| 4 | Scheduling / carbon-data audit | next |
| 5 | Experiments, research report generator, ML status | pending |
| 6 | Frontend audit (password change and admin accounts UI, states) | pending |
| 7 | Docs, final QA, PRs, final report | pending |

## Defects found and fixed this sprint

| Id | Defect | Branch |
|---|---|---|
| S1 | login response time revealed whether a username exists | p8-security |
| S2 | public `/cluster/health` returned kubectl output (control-plane address) and spawned kubectl per request | p8-security |
| S3 | public compute endpoints not rate limited | p8-security |
| S4 | unexpected errors returned exception text (paths, internals) | p8-security |
| S7/S8 | no password change (token invalidation unreachable); no account management except CLI | p8-security |
| T1 | collector static-check test failed on Windows (CRLF) | p8-security, p8-job-lifecycle |
| B7 | frontend silently defaulted to the suspended backend | p8-pages-api-url |
| L1 | execution status not persisted (restart showed completed jobs as scheduled) | p8-job-lifecycle |
| L2 | duplicate dispatch | p8-job-lifecycle |
| L3 | dispatch without a recommended window | p8-job-lifecycle |

## Collector

| Time | PID | Runs | Records | Failures | First-90-lines sha256 |
|---|---|---|---|---|---|
| 21:36 | 3304 | 10 | 100 | 0 | `29f7edb8…` |
| 23:39 | 3304 | 12 | 120 | 0 | `29f7edb8…` |

## Open blockers

- B3: staging storage option (needs owner approval; possible cost).
- B7 (owner action): set repository variable `VITE_API_URL` once a new backend exists.
- Seven days of data not yet collected; ML model untrained (insufficient data).

## Next action

Scheduling-engine and carbon-data audit (policies on identical inputs, oracle offline only, timezone
handling, explanation quality), then the research report generator.

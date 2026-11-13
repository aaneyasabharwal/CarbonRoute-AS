# Sprint progress (P8 completion sprint)

Durable log for the autonomous completion sprint that started 2026-11-13 21:36 UTC. Updated after
each milestone. Times are UTC. Claims use: **implemented**, **tested locally**, **verified in CI**,
**verified with real data**, **deployed**, **not implemented**, **not validated**.

## Baseline (recovered 2026-11-13 21:36)

| Item | Verified state |
|---|---|
| `fix/prototype-flaws` | `1ba4508` (merge of PR #15); post-merge CI 4/4 green (Backend incl. lock stress, Frontend, Python, Docker) |
| `main` | `80b411a`, untouched |
| Open PRs | none (PR #15 merged; not to be reopened) |
| Working tree | clean |
| Collector | pid 3304 (wrapper delegating to `runCollectorCli`), owns the socket lock on port 26554 (probe start refused) |
| Collected data | `collection-2026-11-13.jsonl`: 100 records, 10 runs, 0 failures, last run 21:06; first 90 lines sha256 `29f7edb8…` unchanged since the lock swaps |
| Old Render backend | still suspended (`503`, `x-render-routing: suspend-by-user`) |
| Other node processes | none |

## Milestones

| # | Milestone | Branch / PR | Status |
|---|---|---|---|
| 0 | Collector lock (PR #15) | merged `1ba4508` | **complete**: verified in CI; lock held by the live collector |
| 1 | Security hardening | `task/p8-security` | in progress |

## Known defects / blockers (open)

- B7: GitHub Pages build has no `VITE_API_URL`; falls back to the suspended backend.
- B3: staging storage option not chosen (needs owner approval and possibly cost).

## Next action

Security fixes on `task/p8-security` (login timing, cluster-health exposure, public endpoint
limits, error-message leakage, password change and admin account management).

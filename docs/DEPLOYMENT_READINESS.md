# Deployment readiness report (P7 stabilisation)

Date: 2026-11-13 (UTC). Code: `fix/prototype-flaws` plus the P7 branch. **Nothing has been deployed,
no production credential has been rotated, and `main` has not been changed.** Every step marked
**[APPROVAL]** waits for the project owner's explicit approval.

## 1. Verdict

**Not ready for production. Ready to prepare a staging deployment** once blockers B1–B3 are decided.
The code is verified locally and in CI; the hosting side (Render configuration, persistence, secrets)
has not been inspected because it is only reachable through the owner's Render account.

## 2. Blockers

| # | Blocker | Why it blocks | Resolution |
|---|---|---|---|
| **B1** | **The live backend `https://carbonroute.onrender.com` runs pre-remediation code.** On 2026-11-13 it answered a request from `Origin: https://evil.example` with that origin and `Access-Control-Allow-Credentials: true`; remediated routes (`/api/jobs`, `/api/results/*`) return 404. That code version had a committed default admin password and JWT secrets, which remain in git history. | Any website can call it with a visitor's credentials; anyone who read the repository history may be able to sign in or forge tokens. | Containment (§3, step 1) and redeployment with new secrets (§3, steps 2–7). |
| **B2** | Render configuration is unknown to this review: deploy branch, environment variables, disk persistence, plan. | Cannot confirm which secrets are in use or whether data survives a deploy. | Owner checks the items in §4 in the Render dashboard. |
| **B3** | No persistent storage decided. The backend stores users, tokens and jobs in a JSON file; on an ephemeral disk they are lost on every deploy/restart. | Accounts, job history and the token revocation list would disappear with every deploy. | Persistent disk (on Render a paid feature; confirm on your plan) **or** accept ephemeral staging data explicitly. |
| B4 | Docker images are built and smoke-tested **only in CI** (Docker is not installed on the development machine). | Local container runs are unverified. | CI job `Docker images` (P7): see its result on the P7 PR. |
| B5 | GitHub Pages deploys only from `main`. | The public frontend stays on the old code until a merge to `main`. | **[APPROVAL]** merge after staging passes. |
| B6 | Only ~6 h of carbon data; the ML model is untrained. | Not a deployment blocker, but no research result may be presented as established. | Keep collecting (COLLECTOR.md). |

Accepted risks for staging (state them, do not hide them): token in `localStorage` (XSS exposure,
mitigated by CSP); single instance (in-memory rate limits/budget); JSON storage.

## 3. Credential rotation and secure redeployment plan

Principles: old secrets are treated as **public** (they are in git history). New secrets are
generated locally, never printed, never committed, never pasted into chat, issues or logs. They go
directly from the generator into the Render dashboard (or a password manager).

1. **[APPROVAL] Contain the live backend now.** Options, in order of safety:
   a. *Suspend* the Render service (the public Pages site loses its backend until step 7), or
   b. at minimum, in Render → Environment, set a **new** `JWT_SECRET` (invalidates every existing
      token) and restart. This does not fix the CORS reflection, which is in the old code.
2. **Generate new secrets locally** (output goes to the clipboard, not the screen; Windows):
   ```bash
   node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | clip
   ```
   Paste once into Render as `JWT_SECRET`; repeat for `ADMIN_PASSWORD` (or use a password-manager
   generated password of ≥ 16 characters). Do not store them in any file in the repository.
3. **Electricity Maps key.** If the old service had `ELECTRICITY_MAPS_API_KEY` set, reuse is
   acceptable only if it was never exposed; otherwise create a new key in the Electricity Maps
   dashboard. Never copy it from the local `.env` into chat or logs.
4. **[APPROVAL] Create a separate staging service** on Render from branch `fix/prototype-flaws`
   (not `main`), with a **fresh database** (do not copy the old hosted database: its accounts may use
   the published default password). Settings in §5.
5. **Create accounts on staging** through the Render shell, reading passwords from the environment:
   `cd backend && NEW_USER_USERNAME=… NEW_USER_EMAIL=… NEW_USER_PASSWORD=… NEW_USER_ROLE=student npm run user:create`.
6. **Verify staging** with the checklist in §6. Record results, not secrets.
7. **[APPROVAL] Production cut-over:** merge `fix/prototype-flaws` into `main` (deploys Pages), point
   the production Render service at the new code with the new secrets and a fresh, persistent
   database, re-run §6 against production, then delete or archive the old service and its disk.
8. **Afterwards:** confirm the old admin password and an old token no longer work (they must fail with
   401), and that `Origin: https://evil.example` receives no `Access-Control-Allow-Origin`.

Local development credentials were already rotated during the remediation (after M1.1); that rotation did
not touch any hosted service.

## 4. What the owner must check in Render (B2)

- Which branch each service deploys from, and whether auto-deploy is on (it must not deploy `main`
  to staging, or `fix/prototype-flaws` to production, unintentionally).
- Which environment variables are set (names only), especially `JWT_SECRET`, `ADMIN_PASSWORD`,
  `CORS_ORIGIN`, `ELECTRICITY_MAPS_API_KEY`.
- Whether a persistent disk exists and where it is mounted; the instance plan.
- Node version (must be 20) and build/start commands.

## 5. Staging deployment checklist

**Service (Render web service, staging)**
- [ ] Branch `fix/prototype-flaws`; auto-deploy off until verified.
- [ ] Node 20. Build: `cd backend && npm ci && npm run build`. Start: `cd backend && npm start`.
- [ ] Health check path: `/api/health`.

**Environment** (see ENVIRONMENT.md; values only in Render)
- [ ] `NODE_ENV=production` (the server refuses to start without a valid `JWT_SECRET`).
- [ ] `JWT_SECRET`: new, ≥ 32 random characters, generated as in §3.
- [ ] `ADMIN_PASSWORD`: new, only for the first start with an empty database; remove it afterwards.
- [ ] `CORS_ORIGIN`: exactly the staging frontend origin(s), comma-separated, no wildcard, no trailing
      slash (e.g. `https://<staging-frontend-host>`). Local testing origin only if needed.
- [ ] `TRUST_PROXY=1` (Render is one proxy hop; needed for per-address login limits).
- [ ] `ELECTRICITY_MAPS_API_KEY` if live data is wanted; `EM_MAX_CALLS_PER_HOUR` / `_PER_DAY` below
      the plan limit (trial key expires ~26–27 Nov 2026).
- [ ] Rate limits: defaults unless there is a reason (`RATE_LIMIT_*`).

**Persistence**
- [ ] Persistent disk mounted (e.g. `/var/data`), and `CARBONROUTE_DB_FILE=/var/data/carbonroute.db.json`
      (the scheduling store is created next to it), `LOCAL_STORAGE_DIR=/var/data/uploads`.
- [ ] `BENCHMARK_RESULTS_DIR=/var/data/results/benchmark-results`, `ML_RESULTS_DIR=/var/data/results/ml-results`,
      and copy the result files there if the Results page should show them (they contain no secrets).
- [ ] Without a disk: write "staging data is ephemeral" in the staging notes and expect sign-outs on
      every deploy.

**Frontend for staging**
- [ ] Build with `VITE_API_URL=https://<staging-backend-host>` (e.g. a Vercel preview using the root
      `vercel.json`, or a local `npm run build && npx vite preview`), and add that origin to the
      backend's `CORS_ORIGIN`.
- [ ] GitHub Pages (production only, from `main`): base path now follows the repository name
      (`/CarbonRoute-AS/` on this repository; `PAGES_BASE_PATH` overrides it).

## 6. Staging verification (run after deploying; record outcomes)

- [ ] `GET /api/health` → 200.
- [ ] `Origin: https://evil.example` → no `Access-Control-Allow-Origin`; the staging frontend origin is
      echoed.
- [ ] `GET /api/jobs` without a token → 401; live `/api/carbon/forecast` without a token → 401.
- [ ] Sign in with a staging account; wrong password → 401; repeated failures → 429 with `Retry-After`.
- [ ] Schedule a live job (1 provider call): decision with `dataClass: real`, raw SHA-256, explanation,
      5 policies, cost-aware and oracle unavailable.
- [ ] A second account cannot read the job (404).
- [ ] Dispatch is labelled "simulated" (no cluster on Render).
- [ ] Logout → the old token gets 401.
- [ ] Redeploy, then sign in again: with a persistent disk the account and job still exist.
- [ ] Server logs contain no password, token or API key.

These are the same checks as the local end-to-end run (30/30 on 2026-11-13); the script used for that
run lives outside the repository because it creates accounts with generated passwords.

## 7. Steps that need the owner's approval (summary)

1. Contain the live backend (suspend, or set a new `JWT_SECRET`) — §3.1.
2. Create the staging service, its disk (possible cost) and its secrets — §3.4, §5.
3. Rotate/replace the Electricity Maps key if it was exposed — §3.3.
4. Merge `fix/prototype-flaws` into `main` (this deploys GitHub Pages) — §3.7.
5. Switch the production backend to the new code with new secrets and a fresh database; retire the
   old service and disk — §3.7.
6. Restart the data collector after its 25th run (about 2026-11-14 13:32 UTC) for 168 hourly runs —
   COLLECTOR.md.

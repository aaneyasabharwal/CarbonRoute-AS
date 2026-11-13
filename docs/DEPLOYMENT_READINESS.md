# Deployment readiness report (P7 stabilisation)

Date: 2026-11-13 (UTC). Code: `fix/prototype-flaws` plus the P7 branch. **Nothing has been deployed,
no production credential has been rotated, no Render service or disk has been created, and `main`
has not been changed.** Every step marked **[APPROVAL]** waits for the project owner's explicit
approval.

## 1. Verdict

**Not ready for production. Ready to prepare a staging deployment** once blockers B2, B3 and B7 are
decided. The old backend is contained (suspended, B1). The code is verified locally and in CI.

## 2. Blockers

| # | Blocker | Status / why it blocks | Resolution |
|---|---|---|---|
| B1 | The old backend `https://carbonroute.onrender.com` ran pre-remediation code: on 2026-11-13 ~20:00 UTC it echoed `Origin: https://evil.example` with `Access-Control-Allow-Credentials: true`, and that code version used the default admin password and JWT secrets that remain in git history. | **Contained.** The owner's Render service was **suspended manually** (not deleted; data, settings and secrets untouched). **Externally verified 2026-11-13 20:35 UTC:** `/`, `/api/health`, `/api/auth/login` (GET and POST) and `/api/presentations` all return **503** with `x-render-routing: suspend-by-user` and **no** `Access-Control-Allow-*` headers. | Keep it suspended; **do not resume it**. Replace it with the secured code and new secrets (§3). Retire it only after the replacement is verified. |
| **B2** | The old service's settings were not inspected: deploy branch, auto-deploy, environment variable names and disks. The owner reports it is on Render **Free**, which has no persistent disk. | We don't know which secrets it used or whether anything on it needs keeping. Low risk while it stays suspended. | Owner records the items in §4 (names only) before it is ever resumed or deleted. |
| **B3** | No persistent storage decided. The backend keeps users, revoked tokens and jobs in a JSON file. Render Free has no persistent disk, so the data would be lost on every deploy, restart or spin-down. | Accounts, job history and the token revocation list would disappear; the staging persistence test cannot pass. | **[APPROVAL]** Option A (recommended): Starter instance + 1 GB disk (paid). Option B: Free, data explicitly ephemeral. Option C: external database (large code change). See §5. |
| B4 | Docker images are built and smoke-tested **only in CI** (Docker is not installed on the development machine). | Local container runs are unverified. | CI job `Docker images` passes on the P7 PR; nothing is pushed to a registry. |
| B5 | GitHub Pages deploys only from `main`. | The public frontend stays on the old code until a merge to `main`. | **[APPROVAL]** merge after staging passes and B7 is fixed. |
| B6 | Only hours of carbon data; the ML model is untrained. | Not a deployment blocker, but no research result may be presented as established. | Keep collecting (COLLECTOR.md). |
| **B7** | **The Pages workflow does not set `VITE_API_URL`.** `.github/workflows/deploy-pages.yml` builds with `GITHUB_PAGES=true` only, so the bundle falls back to the hard-coded default `https://carbonroute.onrender.com` (`frontend/src/services/api.ts`), which is the **suspended** old backend. | **Not fixed.** A merge to `main` today would deploy a site whose sign-in, presentations, jobs and results all fail (503). | Before any merge to `main`: set `VITE_API_URL` in the Pages build from a repository variable (for example `vars.VITE_API_URL`) pointing at the new backend, and change or remove the hard-coded fallback. Add that backend's Pages origin (`https://aaneyasabharwal.github.io`) to its `CORS_ORIGIN`. |

Accepted risks for staging (state them, do not hide them): token in `localStorage` (XSS exposure,
mitigated by CSP); single instance (in-memory rate limits/budget); JSON storage.

## 3. Credential rotation and secure redeployment plan

Principles: old secrets are treated as **public** (they are in git history). New secrets are
generated locally, never printed, never committed, never pasted into chat, issues or logs. They go
directly from the generator into the Render dashboard (or a password manager).

1. **Contain the old backend — done** (suspended by the owner; verified 2026-11-13 20:35 UTC, see B1).
   Do not resume it; resuming would expose the old code and secrets again.
2. **Generate new secrets locally** (output goes to the clipboard, not the screen; Windows):
   ```bash
   node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | clip
   ```
   Paste once into Render as `JWT_SECRET`; repeat for `ADMIN_PASSWORD` (or use a password-manager
   generated password of ≥ 16 characters). Do not store them in any file in the repository.
3. **Electricity Maps key.** If the old service had `ELECTRICITY_MAPS_API_KEY` set, reuse is
   acceptable only if it was never exposed; otherwise create a new key in the Electricity Maps
   dashboard. Never copy it from the local `.env` into chat or logs.
4. **[APPROVAL] Create a NEW staging service** on Render from branch `fix/prototype-flaws` (not
   `main`), with a **fresh database** (do not copy the old hosted database: its accounts may use the
   published default password). Settings in §5.
5. **Create accounts on staging** through the Render shell, reading passwords from the environment:
   `cd backend && NEW_USER_USERNAME=… NEW_USER_EMAIL=… NEW_USER_PASSWORD=… NEW_USER_ROLE=student npm run user:create`.
6. **Verify staging** with the checklist in §6. Record results, not secrets.
7. **[APPROVAL] Production cut-over:** fix B7, merge `fix/prototype-flaws` into `main` (deploys Pages),
   run the production backend from the new code with new secrets and a fresh, persistent database,
   re-run §6 against production. Retire the old suspended service only then, after the owner has
   recorded §4.
8. **Afterwards:** confirm the old admin password and an old token do not work against the new
   backend (401), and that `Origin: https://evil.example` receives no `Access-Control-Allow-Origin`.

Local development credentials were already rotated during the remediation (after M1.1); that rotation did
not touch any hosted service. Because the Render account password of the old service's owner was
shared to perform the suspension, the owner should change it.

## 4. What the owner should record about the old service (B2, names only)

- Repository, branch and auto-deploy setting.
- Environment variable names, especially `JWT_SECRET`, `ADMIN_PASSWORD`, `CORS_ORIGIN`,
  `ELECTRICITY_MAPS_API_KEY` (this tells us which keys to treat as exposed).
- Instance type and whether any disk exists (owner reports: Free, so no disk).

## 5. Staging deployment plan (NEW Render service; nothing created yet)

**Storage decision (B3)**

| Option | Data survives deploys/restarts | Cost | Code change |
|---|---|---|---|
| **A. Starter instance + 1 GB persistent disk (recommended)** | Yes | Monthly instance + disk fee (check current Render pricing) | None |
| B. Free instance, no disk | No: accounts and jobs vanish on every spin-down/deploy | Free | None; the persistence test will fail by design |
| C. External database | Yes | Varies | Large (new storage layer) |

**Service settings (option A)**
- [ ] New Web Service `carbonroute-staging`; repository `aaneyasabharwal/CarbonRoute-AS`; branch
      `fix/prototype-flaws`; runtime Node; Root Directory empty; **Auto-Deploy off** until verified.
- [ ] Build: `cd backend && npm ci && npm run build`
- [ ] Start: `mkdir -p /var/data/uploads && cp -rn storage/uploads/presentations /var/data/uploads/ && cd backend && npm start`
      (seeds the three committed presentation PDFs onto the disk without overwriting; the disk is not
      available during the build).
- [ ] Health check path: `/api/health`.
- [ ] Disk: mount path `/var/data`, 1 GB.

**Environment** (see ENVIRONMENT.md; values only in Render, all newly generated)
- [ ] `NODE_ENV=production` (the server refuses to start without a valid `JWT_SECRET`).
- [ ] `NODE_VERSION=20` (the repository does not pin a Node version).
- [ ] `JWT_SECRET`: new, 48 random bytes, generated as in §3.
- [ ] `ADMIN_USERNAME`, `ADMIN_EMAIL`; `ADMIN_PASSWORD`: new, only for the first start with an empty
      database; remove it afterwards.
- [ ] `CORS_ORIGIN`: exactly the staging frontend origin(s), comma-separated, no wildcard, no trailing
      slash (e.g. `http://localhost:4173` for a local `vite preview` test).
- [ ] `TRUST_PROXY=1` (Render is one proxy hop; needed for per-address login limits).
- [ ] `CARBONROUTE_DB_FILE=/var/data/carbonroute.db.json` (the scheduling store is created next to it).
- [ ] `STORAGE_TYPE=local`, `LOCAL_STORAGE_DIR=/var/data/uploads`.
- [ ] `BENCHMARK_RESULTS_DIR=/var/data/results/benchmark-results`, `ML_RESULTS_DIR=/var/data/results/ml-results`
      (copy result files there if the Results page should show them; they contain no secrets).
- [ ] `ELECTRICITY_MAPS_API_KEY` only if live data is wanted; `EM_MAX_CALLS_PER_HOUR=60`,
      `EM_MAX_CALLS_PER_DAY=500` (the collector uses about 240 calls/day of the same trial quota; the
      trial key expires ~26–27 Nov 2026).
- [ ] `PORT`: leave unset (Render sets it). Rate limits: defaults (`RATE_LIMIT_*`).

**Frontend for staging**
- [ ] Build locally with `VITE_API_URL=https://carbonroute-staging.onrender.com npm run build`, serve
      with `npx vite preview` (http://localhost:4173), and list that origin in `CORS_ORIGIN`. No
      hosting cost.
- [ ] GitHub Pages is production only (from `main`) and is blocked by B7.

## 6. Staging verification (run after deploying; record outcomes)

- [ ] `GET /api/health` → 200.
- [ ] `Origin: https://evil.example` → no `Access-Control-Allow-Origin`; the staging frontend origin is
      echoed.
- [ ] `GET /api/jobs` without a token → 401; live `/api/carbon/forecast` without a token → 401.
- [ ] Sign in with a staging account; wrong password → 401; repeated failures → 429 with `Retry-After`.
- [ ] Schedule a live job (1 provider call): decision with `dataClass: real`, raw SHA-256, explanation,
      5 policies, cost-aware and oracle unavailable.
- [ ] A second account cannot read the job (404). Dispatch is labelled "simulated" (no cluster).
- [ ] Results pages load; the HTML report downloads.
- [ ] Logout → the old token gets 401.
- [ ] Manual redeploy, then sign in again: with a persistent disk the account and job still exist.
- [ ] Server logs contain no password, token or API key.

These are the same checks as the local end-to-end run (30/30 on 2026-11-13); the script used for that
run lives outside the repository because it creates accounts with generated passwords.

## 7. Steps that need the owner's approval (summary)

1. ~~Contain the old backend~~ — done (suspended, verified 2026-11-13 20:35 UTC). Keep it suspended.
2. Choose the storage option and create the staging service, its disk (cost) and its secrets — §5.
3. Rotate/replace the Electricity Maps key if it was exposed — §3.3.
4. Fix B7 (`VITE_API_URL` for Pages), then merge `fix/prototype-flaws` into `main` (deploys Pages) — §3.7.
5. Run production from the new code with new secrets and a fresh, persistent database; retire the old
   suspended service after §4 is recorded — §3.7.
6. Restart the data collector after its 25th run (about 2026-11-14 13:32 UTC) for 168 hourly runs —
   COLLECTOR.md.

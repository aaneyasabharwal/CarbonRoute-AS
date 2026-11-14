# Staging deployment runbook (P9)

How to put CarbonRoute online as a **staging** site for demonstrations, without touching `main`, the
old suspended Render service (`carbonroute.onrender.com`) or the research data. Everything here is
prepared and rehearsed; **nothing has been created yet**: creating the services needs the owner's
Render account.

> **Deployed 2026-11-14 (option B, Render Free, no persistence):** website
> https://carbonroute-staging-web.onrender.com, API https://carbonroute-staging-api.onrender.com,
> created by the owner from `render.yaml`; no card on file. Latest deploy: PR #27 (`2152b01`) by
> Manual Deploy. Verification: VALIDATION_REPORT.md §4.
>
> **GitHub Pages (2026-11-14):** https://aaneyasabharwal.github.io/CarbonRoute-AS/ serves the same
> frontend, built from `main` (PR #29) by the Pages workflow with the repository variable
> `VITE_API_URL` = the Render API; the API's `CORS_ORIGIN` lists both website origins.
>
> **Owner decision (2026-11-14): option B, Render Free, no persistence.** `render.yaml` is set up for
> it: cost $0, no payment method. **All accounts, jobs and uploads are lost on every deploy, restart
> and after 15 minutes without traffic**; only the admin (from `ADMIN_PASSWORD`) is re-created at each
> start. Committed results (`results/published/`) are always shown. Option A remains documented below.

## 1. What was rehearsed locally (2026-11-14)

A fresh clone of `task/p9-staging-readiness` was built and run exactly as `render.yaml` does
(`NODE_ENV=production`, fresh generated secrets, an empty folder standing in for the disk, no `.env`):

| Check | Result |
|---|---|
| Build with the documented old command `npm ci && npm run build` under `NODE_ENV=production` | **fails** (`tsc` not installed: npm skips dev dependencies). `render.yaml` uses `npm ci --include=dev`. |
| Build and start with the `render.yaml` commands | pass; production mode; admin created from `ADMIN_*` on first start |
| `node scripts/staging-check.mjs` (22 checks: health, CORS allow/deny, CSP, 401s, sign-in, admin creates accounts, demo scheduling with 5 policies and explanation, ownership 404, HTML report, simulated dispatch, second dispatch 409, results and model status, password change and token cut-off, logout revocation) | **22/22 pass** (plus `--live`: correctly 503 "not configured" without a key) |
| Restart the API (a new process, without `ADMIN_PASSWORD`), then `--verify-persisted` | **4/4 pass**: accounts, job and decision survive |
| **Free-plan configuration** (`plan: free`, data in `runtime-data/` of the checkout): staging checks | **22/22 pass** |
| Free plan: restart on a clean filesystem (as Render does), then `--verify-persisted` | admin signs in (re-created); accounts, job and decision are **gone** (3 expected FAILs): the documented free-plan behaviour |
| Static frontend built with `VITE_API_URL` pointing at the API, opened in a browser | pass; calls go to the API origin, CORS allowed, no console errors |
| Frontend bundle scanned for secrets | no key value, no secret; only the variable *name* `ELECTRICITY_MAPS_API_KEY` in help text; no retired host |

## 2. Hosting options (prices checked 2026-11-14; confirm before paying)

The backend keeps users, sessions' revocation list, jobs and decisions in JSON files in one process,
so **persistence needs a persistent disk** (or a database layer, which does not exist).

| Option | Monthly cost | Data survives restarts/deploys | Limits | Verdict |
|---|---|---|---|---|
| **A. Render web service 0.5 CPU / 512 MB + 1 GB disk, frontend as Render static site** | **about $7.25** ($7 instance + $0.25 disk; Hobby workspace $0; static site free) | **Yes** | Single instance; ~1 min downtime per deploy (disks disable zero-downtime deploys); 5 GB/month bandwidth on Hobby | **Recommended** for a university demo: persistent, simple, matches the rehearsal, no code change |
| **B. Render Free web service (no disk) + static site — CHOSEN** | $0 | **No**: lost on every deploy, restart, or after 15 min without traffic (spin-down) | ~1 min cold start; Render may restart it any time; 750 free hours/month | Chosen by the owner. Fine for live demos; the persistence checks fail by design. The admin is re-created on each start from `ADMIN_PASSWORD` (so it must stay set). |
| C. Railway Hobby + volume | $5/month including $5 usage; volumes about $0.15/GB/month | Yes | Usage-based billing; needs a new Railway account; no blueprint here | Workable, more setup |
| D. Fly.io + volume | pay-as-you-go; volumes about $0.15/GB/month | Yes | Needs a card and the Fly CLI; Dockerfile-based | Workable, most setup |
| E. GitHub Pages for the frontend | free | n/a | deploys from `main` only (the `github-pages` environment allows the default branch) | **Enabled 2026-11-14** alongside the Render static site; both call the same API |

Sources: Render pricing (render.com/pricing), Render Free limits (render.com/docs/free), Render
disks (render.com/docs/disks); Railway and Fly.io figures from their docs and third-party 2026
summaries (verify on their pricing pages).

## 3. Owner actions to deploy (option B as configured; option A notes in brackets)

These need the owner (account access and billing); nothing here is automatic.

1. **Merge** the P9 PR into `fix/prototype-flaws` (the Blueprint deploys that branch).
2. Sign in to the Render dashboard of the account that should own staging. Create **new** services
   only; do not open, resume or edit `carbonroute.onrender.com`. No payment method is needed for
   option B. [Option A: add a payment method.]
3. **New > Blueprint**, repository `aaneyasabharwal/CarbonRoute-AS`, branch `fix/prototype-flaws`.
   Render reads `render.yaml` and proposes two services: `carbonroute-staging-api` (Free; [option A: with disk
   `carbonroute-data`, 1 GB]) and `carbonroute-staging-web`.
4. Enter the prompted values (never commit them):
   - `ADMIN_USERNAME`, `ADMIN_EMAIL`; `ADMIN_PASSWORD`: a new random password (at least 12
     characters; generate with `node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`).
   - `CORS_ORIGIN`: the static site URL, e.g. `https://carbonroute-staging-web.onrender.com`
     (Render shows the real URL; it may carry a suffix if the name is taken).
   - `VITE_API_URL` (static site): the API URL, e.g. `https://carbonroute-staging-api.onrender.com`.
   - `ELECTRICITY_MAPS_API_KEY`: optional. If set, it shares the trial quota with the collector
     (about 240 calls/day) and the trial ends around 26–27 Nov 2026. Leave empty for demo data only.
   - `JWT_SECRET` is generated by Render (256-bit); nothing to enter.
5. Apply. If the real URLs differ from what was entered, correct `CORS_ORIGIN` / `VITE_API_URL` in
   each service's Environment tab and redeploy (the static site must be rebuilt for a new
   `VITE_API_URL`).
6. Option B: **keep `ADMIN_PASSWORD`** (the admin is re-created at every start). [Option A: delete
   it after the first successful start.]
7. Before a demonstration: open the site a minute early (cold start), sign in as the admin, create the
   demo accounts on the Account page, and keep using it (15 minutes without traffic resets everything).

## 4. Verify staging (run from this repository)

```bash
STAGING_ADMIN_PASSWORD='<the admin password>' node scripts/staging-check.mjs --api https://carbonroute-staging-api.onrender.com --origin https://carbonroute-staging-web.onrender.com --admin <admin username> --live DE --state staging-check.state.json
```

Option B: skip the persistence check below (it fails by design: data is lost on restart). After a
restart, only check that the admin can sign in again. [Option A: Manual Deploy > "Restart service"
on the API in Render, and:]

```bash
STAGING_ADMIN_PASSWORD='<the admin password>' node scripts/staging-check.mjs --api https://carbonroute-staging-api.onrender.com --origin https://carbonroute-staging-web.onrender.com --admin <admin username> --verify-persisted --state staging-check.state.json
```

In a browser, open the static site: sign in, Dashboard, Prototype (Evaluate), My jobs, Results,
Experiments, Account; check the console has no CORS, mixed-content or API URL errors. Omit
`--live DE` if no key is configured. The state file holds a job id and usernames only and is
git-ignored.

## 5. Operating staging

- **Logs**: Render dashboard > service > Logs (the server never logs passwords, tokens or keys;
  unexpected errors are logged with a reference id that the user also sees).
- **Restart**: Manual Deploy > Restart service. **Redeploy** a new commit: Manual Deploy > Deploy
  latest commit (auto-deploy is off on purpose).
- **Data (option B)**: `runtime-data/` in the service checkout, ephemeral: lost on every deploy,
  restart and spin-down. Nothing to back up; research data never goes to staging.
- **Data (option A)**: `/var/data/carbonroute.db.json` (users, audit log), `/var/data/carbonroute.scheduling.db.json`
  (jobs, decisions, executions), `/var/data/uploads` (PDFs). A Render disk is snapshotted daily by
  Render; for a manual copy use the service Shell (paid instances) or download through the app.
- **Accounts**: administrators create accounts on the Account page; there is no self-registration.
- **Rollback**: redeploy an earlier commit from the Events tab. Suspending the service stops all costs
  except the disk.
- **Production later**: merge `fix/prototype-flaws` into `main` (owner approval), enable Pages
  (Settings > Pages > Source: GitHub Actions), set the repository variable `VITE_API_URL` to the
  production API URL, and add `https://aaneyasabharwal.github.io` to that API's `CORS_ORIGIN`.

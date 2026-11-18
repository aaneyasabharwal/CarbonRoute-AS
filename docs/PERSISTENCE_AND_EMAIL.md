# Persistence and email verification (P22)

This document explains why accounts and resources "reverted" on staging, what was fixed in the
application, what remains an infrastructure limit, and how email verification with one-time codes
works. Every statement here is covered by a test named at the end.

## 1. The persistence bug

**Symptoms (staging):** after creating a student account, uploading a resource or deleting one, the
change showed at once, but later (after a refresh) the student was gone, the upload had disappeared
and deleted items were back. Sometimes the administrator was also signed out.

**Root cause: infrastructure, not the browser and not the database code.**

- The backend wrote every change synchronously to a JSON file (`CARBONROUTE_DB_FILE`) and uploads to
  a folder (`LOCAL_STORAGE_DIR`). The frontend re-reads the lists from the backend after every change
  and on every page load. Reproduced locally: within one process, and after a restart that keeps the
  disk, everything persists.
- On staging both paths are inside the service checkout (`runtime-data/`) of a **Render Free** web
  service. Its disk is ephemeral: it is wiped on **every redeploy, every restart and every spin-down
  (after 15 minutes without traffic)**. At the next start the server seeds an empty database:
  the administrator is re-created from `ADMIN_PASSWORD` with a **new id** (so the old session token
  is rejected and the admin appears signed out), students and uploads are gone, and the seeded
  presentations reappear, including ones that had been deleted.
- Reproduced locally with a real process: create, upload and delete, then restart with the data
  folder deleted. The student and upload are gone, the deleted presentation is back and the old token
  answers 401, exactly as on staging.
- Accounts and resources were the **same bug**: both live in the same ephemeral file and folder.

**Application-level problems found and fixed on the way**

| Problem | Effect | Fix |
|---|---|---|
| Database file written in place | A crash mid-write leaves a truncated file | Write to a temporary file, then rename (atomic) |
| An unreadable database file was silently replaced by seed data | Total, silent data loss | The file is moved aside (`*.unreadable-<time>`) and the error logged |
| `GET /api/auth/me` failure for any reason removed the stored token | A slow cold start signed the user out | The token is removed only when the server answers 401/403 |
| Resource lists returned an empty list on any error | An outage looked like "no resources", and stale state could not be told apart | Failures are returned and shown as errors with a retry button |
| API answers had no `Cache-Control` | A browser could in principle reuse an old list on refresh | Every `/api` answer is `Cache-Control: no-store` (files and the zone catalogue keep their own) |
| Deleting the protected v1 planning presentation answered 500 | Looked like a server failure | 409 with an explanation |

**Infrastructure fix: a durable store (free).** When `DATABASE_URL` is set, the two documents
(main database, scheduling store) and all uploaded files are stored in PostgreSQL and loaded from it
at start-up. A change request (POST/PUT/PATCH/DELETE) only answers after its write reached the
database; if the write fails the client gets **503 `NOT_PERSISTED`**, never a success. If
`DATABASE_URL` is set but unusable, the server **refuses to start** rather than silently using the
ephemeral disk. Without `DATABASE_URL` nothing changes for local development.

`GET /api/health` now reports `persistence: { mode, durable, startedAt, note }`; a changed
`startedAt` means the server restarted. The admin page shows a "Temporary storage" notice whenever
`durable` is false.

### What survives what

| Situation | Without `DATABASE_URL` (staging today) | With `DATABASE_URL` (Neon) |
|---|---|---|
| Page refresh | Yes | Yes |
| Backend restart / spin-down | **No** on Render Free (yes locally, disk kept) | Yes |
| Redeploy | **No** on Render Free | Yes |
| Uploaded files | Lost with the disk | Stored in the database (`carbonroute_blobs`) |
| Seeded presentation PDFs | Re-copied from the repository at each start | Same (read from disk; they are in git) |
| Sessions after a restart | Old tokens rejected (new admin id) | Kept (same ids, same `JWT_SECRET`) |
| Login rate-limit counters | Reset on restart (in memory) | Reset on restart (in memory) |

### Free durable option: Neon PostgreSQL

- Neon Free: 1 GB storage per project, no time limit, **no credit card**; writes fail (no bill) when
  full. Render's own free PostgreSQL databases expire after a limited period (check render.com/docs/free), so they are not used.
- Owner steps (account creation is the owner's): create a Neon project (region close to the Render
  service, e.g. Singapore or Frankfurt), copy its connection string (`postgresql://…?sslmode=require`),
  add it as `DATABASE_URL` in the Render API service's Environment tab, then Manual Deploy. The
  server creates its two tables on first start and copies its current data into them.
- Uploaded files are kept in the database: fine for course documents; 1 GB is shared with the data.
  The upload limit stays 50 MB per file.

## 2. Email verification with one-time codes

### Flow

1. An administrator creates an account (there is no self-registration). It starts **unverified**
   and a first code is sent to its address.
2. The owner signs in with username and password. With a correct password the server answers
   `403 EMAIL_NOT_VERIFIED` with a short-lived **verification ticket**, the masked address and what
   happened to the code (`sent`, `simulated`, `failed`, `not-configured`, `rate-limited`).
   A wrong password answers the usual `401 Invalid credentials`, identical for unknown users, so the
   verification state cannot be used to discover accounts.
3. The page shows the verification step: enter the 6-digit code, or request a new one.
4. `POST /api/auth/verify-email/confirm {verificationTicket, code}` verifies the account and signs it
   in. Verified accounts then sign in normally.
5. Every authenticated request checks the flag server-side: a token of an unverified account is
   refused with `403 EMAIL_NOT_VERIFIED`, whatever the frontend does.

### Codes

| Rule | Value |
|---|---|
| Generation | `crypto.randomInt(0, 1_000_000)`, zero-padded to 6 digits, on the backend |
| Storage | HMAC-SHA256 of (account id, purpose, code), keyed from `JWT_SECRET`; never the code |
| Lifetime | 5 minutes |
| Use | Single use; a new code closes every earlier open code |
| Wrong attempts | 5 per code, then the code is closed and a new one is needed |
| Resend | 60 s between codes and 5 codes per rolling hour per account (stored with the codes) |
| Per address | `RATE_LIMIT_OTP_MAX` (default 20) resend/confirm requests per 15 min per IP |
| Ticket | JWT with its own audience, 15 minutes; never accepted as an access token, and vice versa |
| Comparison | Constant-time (`timingSafeEqual`) |

Codes never appear in API responses, in the database or in production logs.

### Exceptions (documented, deliberate)

- **Operator-configured administrator**: the account named by `ADMIN_USERNAME` is treated as
  verified (`admin-bootstrap`), so the operator cannot be locked out. No other account is ever marked
  verified automatically.
- **Administrator attestation**: on the Account page, "Confirm manually"
  (`POST /api/admin/users/:id/verify-email {"confirm": true}`) marks an address as verified by an
  administrator (`admin-attested`). It is recorded in the audit log. Intended for servers without an
  email provider.
- **Operator CLI**: `NEW_USER_EMAIL_VERIFIED=true npm run user:create` (`operator-cli`).

### Email providers

| `EMAIL_PROVIDER` | Behaviour |
|---|---|
| `brevo` | Real email through Brevo's HTTPS API. Needs `BREVO_API_KEY` and `EMAIL_FROM`. |
| `console` | **Development only.** Nothing is sent; the message is printed to the server console as `[DEV EMAIL - NOT SENT]` and reported as `simulated`. Refused when `NODE_ENV=production`. |
| unset / `none` | No delivery. Codes are reported as `not-configured` (never "sent") and closed at once. |

**Why Brevo:** Render Free **blocks outbound SMTP** (ports 25, 465 and 587; see the Render changelog entry "free web services will no longer allow outbound traffic to SMTP ports"), so
Gmail SMTP and similar cannot work there; an HTTPS API is required. Brevo's free plan sends 300
emails/day with no card and no expiry, and lets you send from a **single verified sender address**
without owning a domain. Alternatives considered: Resend (free, but without your own domain it only
delivers to the account owner's address), Mailjet (free 200/day, HTTPS API; similar sender
verification), Gmail SMTP (free but blocked on Render Free).

**Brevo limits to know:** 300 emails/day; the sender address must be verified (Brevo emails a
confirmation link); without your own domain (SPF/DKIM), mail from a free-mail sender such as a Gmail
address may land in spam or be rejected by strict receivers. Brevo adds its branding on the free plan.

**Owner setup (when wanted; nothing is configured yet):**

1. Create a free Brevo account (owner's own step), add and verify a sender address.
2. SMTP & API > API keys > create a key.
3. In the Render API service, Environment: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY=<key>`,
   `EMAIL_FROM=<verified sender>`, optionally `EMAIL_FROM_NAME=CarbonRoute`. Manual Deploy.
4. `GET /api/auth/verification-config` should then report `emailDelivery: "configured"`.

The provider is behind a small interface (`backend/src/services/emailProvider.ts`); another HTTPS
provider can be added without changing the verification logic.

### Email address checks

- Syntax: a practical RFC 5321 subset (length limits, dot-atom local part, hostname labels, letter TLD).
- DNS (`EMAIL_DNS_CHECK`, on outside tests): rejects only domains that definitely cannot receive mail
  (domain does not exist, or a null MX). Timeouts and server failures never reject.
- Neither proves the mailbox exists; only entering the code does. Disposable-address lists were not
  added: they go stale and block legitimate users, and the code already proves ownership.

## 3. Environment variables (backend only)

| Variable | Purpose | Secret |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string; enables durable storage | Yes |
| `DATABASE_SSL` | `false` only for a local database without TLS | No |
| `EMAIL_PROVIDER` | `brevo`, `console` (development only) or unset | No |
| `BREVO_API_KEY` | Brevo API key | Yes |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Verified sender address and display name | No |
| `EMAIL_DNS_CHECK` | `false` to turn the DNS check off | No |
| `RATE_LIMIT_OTP_MAX` | Verification requests per IP per 15 min (default 20) | No |

Secrets go only into the Render Environment tab or a local `.env` (git-ignored), never into the
repository or the frontend.

## 4. Tests

- `backend/test/isolation/persistence.test.ts`: refresh, restart with kept disk, restart with wiped
  disk with and without the durable store (pg-mem), files and deletions, jobs, write failure → 503,
  unusable `DATABASE_URL`, corrupt file kept aside, atomic writes, `no-store`.
- `backend/test/security/emailOtp.test.ts`: generation, hashing, binding, valid / incorrect / expired /
  reused codes, attempt and resend limits, supersession, enumeration, ticket/token separation,
  server-side enforcement, admin attestation, provider failure, no provider, development provider
  refused in production, email syntax and DNS rules.
- `frontend/test/services/persistenceAndVerification.test.ts`, `frontend/test/components/EmailVerification.test.tsx`,
  `frontend/test/pages/AccountVerification.test.tsx`.

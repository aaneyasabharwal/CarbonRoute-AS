# Backend tests

```bash
cd backend
npm test            # run once
npm run test:watch  # re-run on change
npm run typecheck   # type-check src and tests
```

Tests run directly against the TypeScript sources with [Vitest](https://vitest.dev); no build step is needed.
API tests use [supertest](https://github.com/ladjs/supertest) on the Express app from `src/app.ts`, so no server or port is required.

## Isolation

`test/setup.ts` runs before every test file and calls `createTestEnv()` from `test/support/testEnv.ts`, which:

- points the JSON database (`CARBONROUTE_DB_FILE`) and uploads (`LOCAL_STORAGE_DIR`) at a fresh temporary directory, so tests never read or modify `database/carbonroute.db.json` or real uploads;
- clears `ELECTRICITY_MAPS_API_KEY`, so no real key is used. Tests that need provider responses stub `fetch`;
- creates a test-only admin account (`test-admin`) with a password generated randomly for each test file. Tests log in with `loginAsTestAdmin()` / `testAdminCredentials()` from `test/support/auth.ts` and never use the hardcoded seeded password (removing that credential from the code is task M1.1).

After each file, the previous values of all variables are restored (variables that did not exist are deleted) and the temporary directory is removed.

`test/isolation/isolation.test.ts` checks all of this: the temporary paths, that writes land there, that the real database file and upload folders are byte-for-byte unchanged, that environment variables are restored, and that each file starts from a fresh database.

Files that dispatch jobs mock `child_process`, so tests never run `kubectl` against a real cluster.

Every file passes when run on its own (`npx vitest run <file>`), together, and in shuffled order (`npx vitest run --sequence.shuffle`).

## Layout

| Folder | Contents |
|---|---|
| `test/legacy/` | Characterization tests ported from the original scripts in `/tests` (`*.legacy.test.ts`). |
| `test/security/` | M1.1 credential handling: JWT secret resolution, initial-admin seeding from the environment, password rotation script, and a scan that no formerly published secret remains in tracked files (`credentials.test.ts`). M1.2 job-route authentication and ownership: unauthenticated requests, owners, non-owners (IDOR), admins, listing, cancellation, invalid/expired/revoked tokens (`jobAccess.test.ts`). Users and passwords are generated at run time. |
| `test/features/` | Tests for existing behaviour that must be preserved, plus `[legacy]` blocks for audit-flagged behaviour. |
| `test/isolation/` | Tests proving the suite is isolated from real data and from other test files. |
| `test/support/` | Test environment and authentication fixtures. |

## Legacy tests

Tests whose names or describe blocks start with `[legacy]` record **current** behaviour, including behaviour the audit found invalid (for example the deadline-risk model, audit C1, and random realized carbon, audit C2).

A `[legacy]` assertion may only be changed or removed by the pull request that intentionally removes that behaviour. That pull request must cite the audit finding and explain the change in its description. No other legacy assertion may change in the same pull request.

Some original assertions cannot pass against the current code because the original test itself was wrong (for example, comparing team names to bare first names). These are kept verbatim and marked `it.fails`: Vitest reports them as passing only while the original assertion still fails, so the discrepancy stays visible. The intended, correct behaviour is tested separately in `test/features/`, next to a comment pointing back to the original. The `it.fails` tests are removed when the original `/tests` scripts are retired.

The original scripts in `/tests` are kept until these ports have been reviewed; they require a built `backend/dist` and, for the API scripts, a running server.

The provider responses used here are hand-written mocks in the shape the current parser expects. They are not recorded Electricity Maps responses (those are task M5.0, pending confirmed API access).

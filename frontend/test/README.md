# Frontend tests

```bash
cd frontend
npm test            # run once
npm run test:watch  # re-run on change
npm run typecheck   # type-check src and tests
```

Tests use [Vitest](https://vitest.dev) with [jsdom](https://github.com/jsdom/jsdom) and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/). They live in `frontend/test/`, outside `src/`, so `npm run build` does not compile them.

## Isolation

`test/setup.ts` runs before every test file and:

- blocks network access: by default `fetch` rejects, so no test can reach a real backend (local or the deployed `carbonroute.onrender.com`). Tests that need a backend response stub `fetch` with `stubFetch()` from `test/support/fetch.ts`. Those responses are hand-written test data in the backend's response shape, not recorded production responses;
- clears `localStorage` before and after each test, and removes every stub and spy afterwards.

## Layout

| Folder | Contents |
|---|---|
| `test/services/` | `src/services/api.ts`: URL resolution, authentication, scheduling calls, and `[legacy]` client-side fallbacks. |
| `test/context/` | `AuthContext`: session restore, login, logout, invalid tokens. |
| `test/app/` | Smoke test: every route in `App.tsx` renders without crashing while the backend is unreachable. |
| `test/support/` | `fetch` stubbing helpers. |

## Legacy tests

Blocks tagged `[legacy]` record current behaviour that the audit (or a later observation) flagged, for example the client-generated scheduling result returned when the backend is unreachable (audit H4, task M2.5). They may only be changed by the pull request that intentionally changes that behaviour, citing the finding, as described in `backend/test/README.md`.

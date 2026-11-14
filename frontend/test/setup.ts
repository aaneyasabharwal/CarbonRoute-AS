/**
 * Runs before every frontend test file.
 *
 * - Adds the jest-dom matchers (toBeInTheDocument, ...).
 * - Blocks all network access: by default `fetch` rejects, so no test can reach
 *   the real backend (localhost:5000 or the deployed carbonroute.onrender.com).
 *   Tests that need a backend response stub `fetch` themselves with test/support/fetch.ts.
 * - Starts every test with empty localStorage, and undoes all stubs afterwards.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

export const NETWORK_DISABLED_MESSAGE = 'Network access is disabled in tests';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError(NETWORK_DISABLED_MESSAGE);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

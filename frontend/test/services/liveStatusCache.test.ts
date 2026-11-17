/**
 * P20 regression (screenshot): after the provider key was added on the server, the Scheduler kept
 * showing "Live data is not configured on this server (no provider key)" because the browser reused a
 * zone catalogue cached under the old `max-age=3600` header. The page must ask for a revalidated
 * catalogue and an uncached provider status on every load.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { api, API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

afterEach(() => vi.unstubAllGlobals());

describe('live-data status is never read from the browser cache', () => {
  it('zone catalogue is fetched with cache: no-cache', async () => {
    const fetchMock = stubFetch((url) =>
      url === `${API_BASE}/carbon/catalogue` ? { body: { success: true, data: { meta: {}, liveConfigured: true, zones: [] } } } : undefined,
    );
    const r = await api.getZoneCatalogue();
    expect(r.success).toBe(true);
    expect(r.data?.liveConfigured).toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init?.cache).toBe('no-cache');
  });

  it('provider status is fetched with cache: no-store', async () => {
    const fetchMock = stubFetch((url) =>
      url === `${API_BASE}/carbon/provider` ? { body: { success: true, data: { configured: true, historyWindowHours: 24, pastRangeAvailable: false } } } : undefined,
    );
    const r = await api.getProviderStatus();
    expect(r.data?.configured).toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init?.cache).toBe('no-store');
  });
});

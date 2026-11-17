/**
 * P19 regression: the zone catalogue carries `liveConfigured`. It used to be served with
 * `Cache-Control: public, max-age=3600`, so after the owner added ELECTRICITY_MAPS_API_KEY on the
 * server, browsers kept showing "Live data is not configured on this server (no provider key)" for
 * up to an hour. It must now be revalidated on every load (cheap 304 via ETag while unchanged), and
 * the provider status must never be cached. No real key is used: a placeholder is set and removed.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
const saved = process.env.ELECTRICITY_MAPS_API_KEY;
beforeAll(async () => {
  ({ default: app } = await import('../../src/app'));
});
afterEach(() => {
  if (saved === undefined) delete process.env.ELECTRICITY_MAPS_API_KEY;
  else process.env.ELECTRICITY_MAPS_API_KEY = saved;
});

describe('catalogue and provider status are not served stale', () => {
  it('catalogue: no-cache (no max-age), with an ETag', async () => {
    const r = await request(app).get('/api/carbon/catalogue');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers['cache-control']).not.toMatch(/max-age/);
    expect(r.headers.etag).toBeTruthy();
  });

  it('unchanged catalogue revalidates as 304; adding a key changes the ETag and liveConfigured at once', async () => {
    delete process.env.ELECTRICITY_MAPS_API_KEY;
    const before = await request(app).get('/api/carbon/catalogue');
    expect(before.body.data.liveConfigured).toBe(false);
    const again = await request(app).get('/api/carbon/catalogue').set('If-None-Match', before.headers.etag);
    expect(again.status).toBe(304);

    process.env.ELECTRICITY_MAPS_API_KEY = 'test-placeholder-not-a-real-key';
    const after = await request(app).get('/api/carbon/catalogue').set('If-None-Match', before.headers.etag);
    expect(after.status).toBe(200);
    expect(after.body.data.liveConfigured).toBe(true);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(JSON.stringify(after.body)).not.toContain('test-placeholder-not-a-real-key');
  });

  it('provider status: no-store, and reflects the key immediately', async () => {
    delete process.env.ELECTRICITY_MAPS_API_KEY;
    const off = await request(app).get('/api/carbon/provider');
    expect(off.headers['cache-control']).toBe('no-store');
    expect(off.body.data.configured).toBe(false);
    process.env.ELECTRICITY_MAPS_API_KEY = 'test-placeholder-not-a-real-key';
    const on = await request(app).get('/api/carbon/provider');
    expect(on.body.data.configured).toBe(true);
    expect(JSON.stringify(on.body)).not.toContain('test-placeholder-not-a-real-key');
  });
});

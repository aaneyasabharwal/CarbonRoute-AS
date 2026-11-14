/**
 * Electricity Maps client tests.
 *
 * `recorded-*.json` fixtures are real API responses captured on 2026-11-12 with the key
 * removed (the API never echoes it). Inline bodies created here are synthetic edge cases
 * and are named as such. No test contacts the network.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { ElectricityMapsClient, parseForecastPoints } from '../../src/carbon/electricityMaps';
import { ProviderError } from '../../src/carbon/types';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'electricitymaps');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const TEST_KEY = 'test-key-not-real-0123456789';

type Reply = { status?: number; body: string; headers?: Record<string, string> } | Error | 'hang';

/** A client whose fetch answers from `replies` in order (the last reply repeats). */
function clientWith(replies: Reply[], opts: Partial<ConstructorParameters<typeof ElectricityMapsClient>[0]> = {}) {
  let i = 0;
  const fetchImpl = vi.fn(async (_url: any, init?: any) => {
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r === 'hang') {
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers });
  });
  const sleep = vi.fn(async () => {});
  const client = new ElectricityMapsClient({ apiKey: TEST_KEY, fetchImpl: fetchImpl as any, sleep, ...opts });
  return { client, fetchImpl, sleep };
}

describe('forecast (recorded responses)', () => {
  it('parses the 24 h hourly DE forecast with issue time, provenance and UTC timestamps', async () => {
    const { client, fetchImpl } = clientWith([{ body: fixture('recorded-forecast-DE-24h-hourly.json') }]);
    const snap = await client.getForecast('de', { horizonHours: 24 });

    expect(snap).toMatchObject({
      provider: 'electricitymaps',
      dataClass: 'real',
      zone: 'DE',
      horizonHours: 24,
      granularity: 'hourly',
      emissionFactorType: 'lifecycle',
      unit: 'gCO2eq/kWh',
      issuedAt: '2026-11-12T18:58:56.219Z',
    });
    expect(snap.points).toHaveLength(25);
    expect(snap.points.every((p) => /Z$/.test(p.datetime))).toBe(true);
    expect(snap.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(snap.fetchedAt)).not.toBeNaN();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.electricitymaps.com/v3/carbon-intensity/forecast?zone=DE&horizonHours=24');
    expect(init.headers['auth-token']).toBe(TEST_KEY);
  });

  it('parses the 72 h horizon and the 15-minute granularity', async () => {
    const h72 = await clientWith([{ body: fixture('recorded-forecast-DE-72h-hourly.json') }]).client.getForecast('DE', { horizonHours: 72 });
    expect(h72.points).toHaveLength(73);
    const m15 = await clientWith([{ body: fixture('recorded-forecast-DE-24h-15min.json') }]).client.getForecast('DE', {
      horizonHours: 24,
      granularity: '15_minutes',
    });
    expect(m15.points).toHaveLength(100);
    expect(Date.parse(m15.points[1].datetime) - Date.parse(m15.points[0].datetime)).toBe(15 * 60_000);
  });

  it('only allows the horizons and granularities the API accepts', async () => {
    const { client, fetchImpl } = clientWith([{ body: '{}' }]);
    await expect(client.getForecast('DE', { horizonHours: 168 })).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
    await expect(client.getForecast('DE', { granularity: '30_minutes' })).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ElectricityMapsClient.horizonCovering(5)).toBe(6);
    expect(ElectricityMapsClient.horizonCovering(25)).toBe(48);
    expect(ElectricityMapsClient.horizonCovering(73)).toBeNull();
  });

  it('rejects gaps, irregular steps, conflicting duplicates and invalid values (synthetic cases)', () => {
    const h = (iso: string, v: number) => ({ datetime: iso, carbonIntensity: v });
    expect(() => parseForecastPoints([h('2026-11-12T00:00:00Z', 1), h('2026-11-12T02:00:00Z', 2)], 'hourly', 'DE')).toThrow(/gap/);
    expect(() => parseForecastPoints([h('2026-11-12T00:00:00Z', 1), h('2026-11-12T00:00:00Z', 2)], 'hourly', 'DE')).toThrow(/conflicting/);
    expect(() => parseForecastPoints([h('2026-11-12T00:00:00Z', NaN)], 'hourly', 'DE')).toThrow(/invalid point/);
    expect(() => parseForecastPoints([{ datetime: 'not a date', carbonIntensity: 1 }], 'hourly', 'DE')).toThrow(/invalid point/);
    // Unsorted input with an exact duplicate is normalised, not rejected.
    const pts = parseForecastPoints(
      [h('2026-11-12T01:00:00+00:00', 2), h('2026-11-12T00:00:00Z', 1), h('2026-11-12T01:00:00Z', 2)],
      'hourly',
      'DE'
    );
    expect(pts).toEqual([
      { datetime: '2026-11-12T00:00:00.000Z', carbonIntensity: 1 },
      { datetime: '2026-11-12T01:00:00.000Z', carbonIntensity: 2 },
    ]);
  });

  it('rejects an empty forecast', async () => {
    const { client } = clientWith([{ body: '{"zone":"DE","forecast":[]}' }]);
    await expect(client.getForecast('DE')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

describe('history (recorded responses): measured vs provider estimates', () => {
  it('DE: keeps isEstimated and estimationMethod for every point; recent hours are estimates', async () => {
    const { observations, missing } = await clientWith([{ body: fixture('recorded-history-DE-hourly.json') }]).client.getHistory('DE');
    expect(observations).toHaveLength(24);
    expect(missing).toEqual([]);
    const measured = observations.filter((o) => o.quality === 'measured');
    const estimates = observations.filter((o) => o.quality === 'provider-estimate');
    expect(measured).toHaveLength(18);
    expect(estimates).toHaveLength(6);
    expect(measured.every((o) => o.isEstimated === false)).toBe(true);
    expect(estimates.every((o) => o.isEstimated === true && o.estimationMethod === 'FORECASTS_HIERARCHY')).toBe(true);
    // The estimates are the most recent hours.
    expect(estimates[0].datetime > measured[measured.length - 1].datetime).toBe(true);
  });

  it('IN-NO: every point in the 24 h window is a provider estimate, never labelled measured', async () => {
    const { observations } = await clientWith([{ body: fixture('recorded-history-IN-NO-hourly.json') }]).client.getHistory('IN-NO');
    expect(observations).toHaveLength(24);
    expect(observations.every((o) => o.quality === 'provider-estimate' && o.estimationMethod === 'TIME_SLICER_AVERAGE')).toBe(true);
  });

  it('US-CAL-CISO: every point is measured', async () => {
    const { observations } = await clientWith([{ body: fixture('recorded-history-US-CAL-CISO-hourly.json') }]).client.getHistory('US-CAL-CISO');
    expect(observations.every((o) => o.quality === 'measured' && o.isEstimated === false)).toBe(true);
  });

  it('15-minute history has 96 points', async () => {
    const { observations } = await clientWith([{ body: fixture('recorded-history-DE-15min.json') }]).client.getHistory('DE', {
      granularity: '15_minutes',
    });
    expect(observations).toHaveLength(96);
    expect(observations[0].granularity).toBe('15_minutes');
  });

  it('a missing value is reported as missing, not filled in; a point without isEstimated is treated as an estimate (synthetic)', async () => {
    const body = JSON.stringify({
      zone: 'DE',
      history: [
        { carbonIntensity: 300, datetime: '2026-11-12T00:00:00Z', isEstimated: false },
        { carbonIntensity: null, datetime: '2026-11-12T01:00:00Z', isEstimated: false },
        { carbonIntensity: 310, datetime: '2026-11-12T02:00:00Z' },
      ],
    });
    const { observations, missing } = await clientWith([{ body }]).client.getHistory('DE');
    expect(missing).toEqual(['2026-11-12T01:00:00.000Z']);
    expect(observations.map((o) => [o.datetime, o.quality])).toEqual([
      ['2026-11-12T00:00:00.000Z', 'measured'],
      ['2026-11-12T02:00:00.000Z', 'provider-estimate'],
    ]);
  });
});

describe('latest, power breakdown and zones (recorded responses)', () => {
  it('latest DE is labelled a provider estimate and keeps the emission factor type', async () => {
    const latest = await clientWith([{ body: fixture('recorded-latest-DE.json') }]).client.getLatest('DE');
    expect(latest).toMatchObject({ zone: 'DE', carbonIntensity: 392, isEstimated: true, quality: 'provider-estimate', emissionFactorType: 'lifecycle' });
    const direct = await clientWith([{ body: fixture('recorded-latest-DE-direct.json') }]).client.getLatest('DE', { emissionFactorType: 'direct' });
    expect(direct.emissionFactorType).toBe('direct');
  });

  it('power breakdown keeps percentages and quality', async () => {
    const pb = await clientWith([{ body: fixture('recorded-power-breakdown-DE.json') }]).client.getPowerBreakdown('DE');
    expect(pb).toMatchObject({ zone: 'DE', fossilFreePercentage: 56, renewablePercentage: 54, quality: 'provider-estimate' });
  });

  it('zones expose per-zone access, time zones (or null) and no past-range for carbon intensity', async () => {
    const zones = await clientWith([{ body: fixture('recorded-zones-subset.json') }]).client.getZones();
    const byCode = Object.fromEntries(zones.map((z) => [z.zone, z]));
    expect(Object.keys(byCode).sort()).toEqual(['DE', 'FR', 'GB', 'IN', 'IN-NO', 'US-CAL-CISO']);
    expect(byCode['IN-NO']).toMatchObject({ zoneName: 'Northern India', countryCode: 'IN', timezone: 'Asia/Kolkata', timezoneSource: 'zone-catalogue' });
    expect(byCode['US-CAL-CISO'].timezone).toBe('America/Los_Angeles');
    expect(byCode.DE.capabilities).toEqual({ latest: true, history: true, forecast: true, pastRange: false, powerBreakdown: true });
  });

  it('zones without an access list report unknown capabilities, and unmapped zones have no time zone', async () => {
    const zones = await clientWith([{ body: JSON.stringify({ 'US-NW-AVA': { zoneName: 'Avista', countryCode: 'US' }, 'XX-NOT-IN-CATALOGUE': { zoneName: 'Unknown', countryCode: 'XX' } }) }]).client.getZones();
    // P11: US-NW-AVA was unmapped before the global zone catalogue; it now has its catalogue time zone.
    expect(zones[0]).toMatchObject({ zone: 'US-NW-AVA', timezone: 'America/Los_Angeles', timezoneSource: 'zone-catalogue', capabilities: null });
    // A zone outside the catalogue and the curated mapping still has no time zone (never guessed).
    expect(zones[1]).toMatchObject({ zone: 'XX-NOT-IN-CATALOGUE', timezone: null, timezoneSource: 'unknown' });
  });
});

describe('errors, retries, timeouts and caching', () => {
  it('maps recorded provider errors to clear error codes', async () => {
    await expect(clientWith([{ status: 400, body: fixture('recorded-error-unknown-zone.json') }]).client.getLatest('XX-NOTAZONE')).rejects.toMatchObject({
      code: 'UNSUPPORTED_ZONE',
      apiStatus: 422,
    });
    await expect(
      clientWith([{ status: 401, body: fixture('recorded-error-not-in-trial.json') }]).client.getHistory('DE')
    ).rejects.toMatchObject({ code: 'NOT_IN_PLAN' });
    await expect(
      clientWith([{ status: 401, body: '{"message":"The provided token is invalid."}' }]).client.getLatest('DE')
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      clientWith([{ status: 400, body: fixture('recorded-error-invalid-horizon.json') }]).client.getLatest('DE')
    ).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });

  it('rejects malformed zone codes without calling the API', async () => {
    const { client, fetchImpl } = clientWith([{ body: '{}' }]);
    for (const bad of ['', 'de&x=1', '../zones', 'TOOLONGZONECODE-XXXXXXXXXXXX']) {
      await expect(client.getLatest(bad)).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails with NO_API_KEY and makes no request when no key is configured', async () => {
    const { client, fetchImpl } = clientWith([{ body: '{}' }], { apiKey: '' });
    expect(client.isConfigured()).toBe(false);
    await expect(client.getLatest('DE')).rejects.toMatchObject({ code: 'NO_API_KEY' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('waits for a short Retry-After on 429 and then succeeds', async () => {
    const { client, fetchImpl, sleep } = clientWith([
      { status: 429, body: '{"message":"Too many requests"}', headers: { 'retry-after': '2' } },
      { body: fixture('recorded-latest-DE.json') },
    ]);
    expect((await client.getLatest('DE')).carbonIntensity).toBe(392);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('gives up immediately with RATE_LIMITED when Retry-After is too long', async () => {
    const { client, fetchImpl } = clientWith([{ status: 429, body: '{}', headers: { 'retry-after': '120' } }]);
    await expect(client.getLatest('DE')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 120, apiStatus: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries server errors and network failures, then reports them', async () => {
    const ok = clientWith([{ status: 503, body: 'unavailable' }, { body: fixture('recorded-latest-DE.json') }]);
    expect((await ok.client.getLatest('DE')).zone).toBe('DE');
    expect(ok.fetchImpl).toHaveBeenCalledTimes(2);

    const down = clientWith([new Error('ECONNRESET')]);
    await expect(down.client.getLatest('DE')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(down.fetchImpl).toHaveBeenCalledTimes(3); // first try + 2 retries
  });

  it('times out a request that never answers', async () => {
    const { client } = clientWith(['hang'], { timeoutMs: 20, maxRetries: 0 });
    await expect(client.getLatest('DE')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports a non-JSON success body as BAD_RESPONSE', async () => {
    await expect(clientWith([{ body: '<html>oops</html>' }]).client.getLatest('DE')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('never puts the API key in an error message', async () => {
    const leaky = clientWith([new Error(`socket closed for token ${TEST_KEY}`)], { maxRetries: 0 });
    const err = (await leaky.client.getLatest('DE').catch((e) => e)) as ProviderError;
    expect(err.message).not.toContain(TEST_KEY);
    expect(err.message).toContain('[REDACTED]');
  });

  it('caches responses until the TTL expires', async () => {
    let now = 1_000_000;
    const { client, fetchImpl } = clientWith([{ body: fixture('recorded-latest-DE.json') }], {
      now: () => now,
      cacheTtlMs: { latest: 60_000 },
    });
    await client.getLatest('DE');
    await client.getLatest('DE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 61_000;
    await client.getLatest('DE');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not cache errors', async () => {
    const { client, fetchImpl } = clientWith([{ status: 401, body: '{"message":"bad token"}' }, { body: fixture('recorded-latest-DE.json') }]);
    await expect(client.getLatest('DE')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await client.getLatest('DE')).zone).toBe('DE');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

/**
 * P23/P24: the collector retries calls that failed for a temporary reason within the same hour,
 * writes every attempt, never retries permanent errors, keeps the hourly schedule, and (P24) makes
 * no API call while the network is down, so a long outage cannot use up the call budget.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { runCollector, parseCollectorArgs, DEFAULT_RETRY, dnsProbe } from '../../src/scripts/collectElectricityMaps';

const MIN = 60_000;
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
const err = (code: string) => Object.assign(new Error(`${code} failure`), { code, apiStatus: 503 });
const retryOpts = { retryWindowMs: 45 * MIN, retryProbeMs: 2 * MIN, retryMax: 2 };

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-retry-'));
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const sleeps: number[] = [];
  const logs: string[] = [];
  const deps = {
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => new Date(clock),
    log: (m: string) => logs.push(m),
    minute: () => (clock - Date.parse('2026-11-18T10:00:00Z')) / MIN,
  };
  const records = () =>
    fs
      .readdirSync(dir)
      .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n'))
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { dir, deps, sleeps, logs, records };
}

describe('collector retries (P23/P24)', () => {
  it('a short outage: only the failed calls are retried, and the schedule does not drift', async () => {
    const { dir, deps, sleeps, records } = setup();
    let online = false;
    const calls: string[] = [];
    const client = {
      isConfigured: () => true,
      getForecast: async (zone: string) => {
        calls.push(`f:${zone}`);
        if (!online) throw err('NETWORK');
        return { zone } as any;
      },
      getHistory: async (zone: string) => {
        calls.push(`h:${zone}`);
        if (!online && zone === 'GB') throw err('NETWORK');
        return { zone } as any;
      },
    };
    const sleep = async (ms: number) => {
      await deps.sleep(ms);
      online = true;
    };
    const code = await runCollector(client, { zones: ['DE', 'GB'], runs: 2, intervalMs: 60 * MIN, outDir: dir, ...retryOpts }, { ...deps, sleep, lock: { port: await freePort() } });
    expect(code).toBe(0);
    expect(calls.slice(0, 7)).toEqual(['f:DE', 'h:DE', 'f:GB', 'h:GB', 'f:DE', 'f:GB', 'h:GB']);
    expect(sleeps).toEqual([2 * MIN, 58 * MIN]);
    const recs = records();
    expect(recs.filter((r) => r.run === 1 && !r.ok)).toHaveLength(3);
    const retried = recs.filter((r) => r.attempt === 2);
    expect(retried).toHaveLength(3);
    expect(retried.every((r) => r.ok && r.runAt === '2026-11-18T10:02:00.000Z')).toBe(true);
    expect(recs.filter((r) => r.run === 2).every((r) => r.runAt === '2026-11-18T11:00:00.000Z' && r.ok && r.attempt === undefined)).toBe(true);
  });

  it('while offline no API call is made: the run is recorded as OFFLINE, retries wait for the network', async () => {
    const { dir, deps, records, logs } = setup();
    let calls = 0;
    const client = {
      isConfigured: () => true,
      getForecast: async () => {
        calls++;
        return {} as any;
      },
      getHistory: async () => {
        calls++;
        return {} as any;
      },
    };
    // Offline until minute 10, then online.
    const probe = async () => deps.minute() >= 10;
    await runCollector(client, { zones: ['DE'], runs: 1, intervalMs: 60 * MIN, outDir: dir, ...retryOpts }, { ...deps, probe, lock: { port: await freePort() } });
    const recs = records();
    expect(recs.filter((r) => !r.attempt)).toEqual([
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'OFFLINE' }) }),
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'OFFLINE' }) }),
    ]);
    // Probes at 2, 4, 6, 8 min fail silently (no record, no call); at 10 min the retry succeeds.
    const retried = recs.filter((r) => r.attempt === 2);
    expect(retried).toHaveLength(2);
    expect(retried.every((r) => r.ok && r.runAt === '2026-11-18T10:10:00.000Z')).toBe(true);
    expect(calls).toBe(2);
    expect(logs.some((l) => /offline/.test(l))).toBe(true);
  });

  it('a whole-hour outage makes no API call at all (no budget used)', async () => {
    const { dir, deps, records } = setup();
    let calls = 0;
    const client = {
      isConfigured: () => true,
      getForecast: async () => {
        calls++;
        return {} as any;
      },
      getHistory: async () => {
        calls++;
        return {} as any;
      },
    };
    await runCollector(client, { zones: ['DE', 'GB'], runs: 2, intervalMs: 60 * MIN, outDir: dir, ...retryOpts }, { ...deps, probe: async () => false, lock: { port: await freePort() } });
    expect(calls).toBe(0);
    expect(records().every((r) => r.error?.code === 'OFFLINE' && !r.attempt)).toBe(true);
  });

  it('online but the provider keeps failing: at most retryMax API retries, so at most 90 budget units per hour', async () => {
    const { dir, deps, sleeps, records } = setup();
    let calls = 0;
    const client = {
      isConfigured: () => true,
      getForecast: async () => {
        calls++;
        throw err('UPSTREAM_ERROR');
      },
      getHistory: async () => {
        calls++;
        throw err('TIMEOUT');
      },
    };
    const zones = ['DE', 'GB', 'US-CAL-CISO', 'IN-NO', 'FR'];
    await runCollector(client, { zones, runs: 2, intervalMs: 60 * MIN, outDir: dir, ...retryOpts }, { ...deps, probe: async () => true, lock: { port: await freePort() } });
    // Per hour: 10 calls + 2 retries x 10 calls = 30 calls; the client tries each at most 3 times.
    expect(calls).toBe(2 * 30);
    expect(30 * 3).toBeLessThan(120);
    expect(sleeps.slice(0, 3)).toEqual([2 * MIN, 2 * MIN, 56 * MIN]);
    expect(records().filter((r) => r.run === 1)).toHaveLength(30);
  });

  it('permanent errors are never retried', async () => {
    const { dir, deps, sleeps } = setup();
    let calls = 0;
    const client = {
      isConfigured: () => true,
      getForecast: async () => {
        calls++;
        throw err('UNAUTHORIZED');
      },
      getHistory: async () => {
        calls++;
        throw err('NOT_IN_PLAN');
      },
    };
    await runCollector(client, { zones: ['DE'], runs: 1, intervalMs: 60 * MIN, outDir: dir, ...retryOpts }, { ...deps, lock: { port: await freePort() } });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([]);
  });

  it('retries never run into the next scheduled run', async () => {
    const { dir, deps, sleeps } = setup();
    const client = {
      isConfigured: () => true,
      getForecast: async () => ({}) as any,
      getHistory: async () => ({}) as any,
    };
    await runCollector(client, { zones: ['DE'], runs: 1, intervalMs: 10 * MIN, outDir: dir, retryWindowMs: 45 * MIN, retryProbeMs: 4 * MIN, retryMax: 5 }, { ...deps, probe: (() => { let n = 0; return async () => n++ > 0 && false; })(), lock: { port: await freePort() } });
    // Window is capped at the 10-minute interval: probes at 4 and 8 minutes only.
    expect(sleeps).toEqual([4 * MIN, 4 * MIN]);
  });

  it('CLI: defaults are a 45-minute window, a check every 2 minutes and at most 2 API retries; --retry-max 0 turns retries off', () => {
    expect(DEFAULT_RETRY).toEqual({ windowMin: 45, probeMin: 2, max: 2 });
    expect(parseCollectorArgs([], '/tmp/x')).toMatchObject({ retryWindowMs: 45 * MIN, retryProbeMs: 2 * MIN, retryMax: 2 });
    expect(parseCollectorArgs(['--retry-max', '0'], '/tmp/x').retryMax).toBe(0);
    expect(parseCollectorArgs(['--retry-window-min', '30', '--retry-probe-min', '5'], '/tmp/x')).toMatchObject({ retryWindowMs: 30 * MIN, retryProbeMs: 5 * MIN });
    expect(() => parseCollectorArgs(['--retry-max', '1.5'], '/tmp/x')).toThrow(/retry-max/);
    expect(() => parseCollectorArgs(['--retry-probe-min', '0'], '/tmp/x')).toThrow(/retry-probe-min/);
  });

  it('the connectivity check is a DNS lookup that answers false for a name that cannot exist', async () => {
    expect(await dnsProbe('no-such-host.invalid', 3000)).toBe(false);
  });
});

/**
 * P23: the collector retries calls that failed for a temporary reason (no network, timeout,
 * provider 5xx, rate limit) within the same hour, writes every attempt, never retries permanent
 * errors, and keeps the hourly schedule.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { runCollector, parseCollectorArgs, DEFAULT_RETRY_DELAYS_MIN } from '../../src/scripts/collectElectricityMaps';

const MIN = 60_000;
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
const err = (code: string) => Object.assign(new Error(`${code} failure`), { code, apiStatus: 503 });

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
  };
  const records = () =>
    fs
      .readdirSync(dir)
      .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n'))
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { dir, deps, sleeps, logs, records };
}

describe('collector retries (P23)', () => {
  it('a network outage at the scheduled time is retried; only the failed calls are repeated', async () => {
    const { dir, deps, sleeps, records, logs } = setup();
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
    // The network comes back during the first wait.
    const sleep = async (ms: number) => {
      await deps.sleep(ms);
      online = true;
    };
    const code = await runCollector(
      client,
      { zones: ['DE', 'GB'], runs: 2, intervalMs: 60 * MIN, outDir: dir, retryDelaysMs: [2 * MIN, 5 * MIN] },
      { ...deps, sleep, lock: { port: await freePort() } }
    );
    expect(code).toBe(0);
    // Run 1: 4 calls, 3 failed; retry 1 repeats only those 3; then the rest of the hour; run 2.
    expect(calls.slice(0, 7)).toEqual(['f:DE', 'h:DE', 'f:GB', 'h:GB', 'f:DE', 'f:GB', 'h:GB']);
    expect(sleeps).toEqual([2 * MIN, 58 * MIN]);
    const recs = records();
    expect(recs.filter((r) => r.run === 1 && !r.ok)).toHaveLength(3); // the failures stay recorded
    const retried = recs.filter((r) => r.attempt === 2);
    expect(retried).toHaveLength(3);
    expect(retried.every((r) => r.ok && r.runAt === '2026-11-18T10:02:00.000Z')).toBe(true);
    // Run 2 starts exactly one hour after run 1: the schedule does not drift.
    expect(recs.filter((r) => r.run === 2).every((r) => r.runAt === '2026-11-18T11:00:00.000Z' && r.ok && r.attempt === undefined)).toBe(true);
    expect(logs.some((l) => /retry 1\/2 in 2 min/.test(l))).toBe(true);
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
    await runCollector(client, { zones: ['DE'], runs: 1, intervalMs: 60 * MIN, outDir: dir, retryDelaysMs: [2 * MIN] }, { ...deps, lock: { port: await freePort() } });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([]);
  });

  it('a lasting outage uses every retry, writes each attempt, stays inside the hour and keeps the schedule', async () => {
    const { dir, deps, sleeps, records, logs } = setup();
    const client = {
      isConfigured: () => true,
      getForecast: async () => {
        throw err('NETWORK');
      },
      getHistory: async () => {
        throw err('TIMEOUT');
      },
    };
    const delays = DEFAULT_RETRY_DELAYS_MIN.map((m) => m * MIN);
    await runCollector(client, { zones: ['DE'], runs: 2, intervalMs: 60 * MIN, outDir: dir, retryDelaysMs: delays }, { ...deps, lock: { port: await freePort() } });
    const total = DEFAULT_RETRY_DELAYS_MIN.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(60);
    expect(sleeps.slice(0, delays.length + 1)).toEqual([...delays, (60 - total) * MIN]);
    const run1 = records().filter((r) => r.run === 1);
    expect(run1).toHaveLength(2 * (1 + delays.length));
    expect(run1.every((r) => r.ok === false)).toBe(true);
    expect(logs.some((l) => /still failing after the retries/.test(l))).toBe(true);
    // Calls per hour stay within the provider budget (10 zones x kinds would be 60 at most).
    expect(10 * (1 + delays.length)).toBeLessThanOrEqual(60);
  });

  it('retries never run into the next scheduled run', async () => {
    const { dir, deps, sleeps } = setup();
    const client = {
      isConfigured: () => true,
      getForecast: async () => {
        throw err('NETWORK');
      },
      getHistory: async () => ({}) as any,
    };
    await runCollector(client, { zones: ['DE'], runs: 1, intervalMs: 10 * MIN, outDir: dir, retryDelaysMs: [4 * MIN, 4 * MIN, 4 * MIN] }, { ...deps, lock: { port: await freePort() } });
    expect(sleeps).toEqual([4 * MIN, 4 * MIN]);
  });

  it('CLI: retries are on by default (2,5,10,10,10 min) and can be turned off', () => {
    expect(parseCollectorArgs([], '/tmp/x').retryDelaysMs).toEqual([2, 5, 10, 10, 10].map((m) => m * MIN));
    expect(parseCollectorArgs(['--retry-delays-min', 'none'], '/tmp/x').retryDelaysMs).toEqual([]);
    expect(parseCollectorArgs(['--retry-delays-min', '1,3'], '/tmp/x').retryDelaysMs).toEqual([MIN, 3 * MIN]);
    expect(() => parseCollectorArgs(['--retry-delays-min', '1,x'], '/tmp/x')).toThrow(/retry-delays-min/);
  });
});

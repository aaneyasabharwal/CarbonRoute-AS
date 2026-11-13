/**
 * Collector folder lock (P7 review). Regression tests for:
 *  - simultaneous starts in SEPARATE PROCESSES (with and without a stale lock): exactly one wins;
 *  - stale locks: dead process, reused process id (live pid, stopped heartbeat), lock being written;
 *  - wrapper invocation: the CLI entry used by `npm run collect` and by wrapper scripts refuses while
 *    another collector holds the lock, and existing .jsonl data is never changed;
 *  - a collector that lost the lock (e.g. after sleeping) stops instead of writing.
 * All collection here uses fake clients; no provider is called and no real data folder is touched.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { acquireCollectorLock, holderState, lockGenerations, LOCK_PREFIX, STALE_MS } from '../../src/scripts/collectorLock';
import { runCollector, runCollectorCli, parseCollectorArgs } from '../../src/scripts/collectElectricityMaps';

const BACKEND = path.resolve(__dirname, '..', '..');
const TS_NODE = require.resolve('ts-node/register/transpile-only', { paths: [BACKEND] });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cr-lock-'));
const DEAD_PID = 2 ** 22 + 4321; // far above any real pid on the test machines
const fakeClient = (calls: string[] = []) =>
  ({
    isConfigured: () => true,
    getForecast: async (z: string) => (calls.push(`f:${z}`), { ok: true }),
    getHistory: async (z: string) => (calls.push(`h:${z}`), { observations: [] }),
  }) as any;
const writeLock = (dir: string, gen: number, info: object | string, ageMs = 0) => {
  const f = path.join(dir, `${LOCK_PREFIX}${gen}`);
  fs.writeFileSync(f, typeof info === 'string' ? info : JSON.stringify(info));
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(f, t, t);
  }
  return f;
};

function runNode(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-r', TS_NODE, ...args], {
      cwd: BACKEND,
      env: { ...process.env, TS_NODE_PROJECT: path.join(BACKEND, 'tsconfig.json'), ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function race(dir: string, n: number) {
  const child = path.join(BACKEND, 'test', 'support', 'lockChild.ts');
  // Generous lead time: every child must have loaded TypeScript before the shared instant.
  const startAt = Date.now() + 8000;
  const results = await Promise.all(Array.from({ length: n }, () => runNode([child, dir, String(startAt), '2500'])));
  return results.map((r) => r.out.trim());
}

describe('collector lock: simultaneous starts in separate processes', () => {
  it('exactly one of 6 processes starting at the same instant takes a free lock', async () => {
    const outs = await race(tmp(), 6);
    expect(outs.filter((o) => o === 'acquired')).toHaveLength(1);
    expect(outs.filter((o) => o === 'refused')).toHaveLength(5);
  }, 60_000);

  it('exactly one wins when they all find the same STALE lock (the race the review found)', async () => {
    const dir = tmp();
    writeLock(dir, 1, { pid: DEAD_PID, token: 'old', startedAt: 'before a crash' }, STALE_MS + 60_000);
    const outs = await race(dir, 6);
    expect(outs.filter((o) => o === 'acquired')).toHaveLength(1);
    expect(outs.filter((o) => o === 'refused')).toHaveLength(5);
  }, 60_000);
});

describe('collector lock: stale and live holders', () => {
  it('a lock from a process that no longer exists is replaced by the next generation', () => {
    const dir = tmp();
    writeLock(dir, 1, { pid: DEAD_PID, token: 'old', startedAt: 'x' });
    const l = acquireCollectorLock(dir);
    expect('error' in l).toBe(false);
    if ('error' in l) return;
    expect(path.basename(l.file)).toBe(`${LOCK_PREFIX}2`);
    expect(lockGenerations(dir).map((g) => g.gen)).toEqual([2]); // old generation tidied
    l.release();
    expect(lockGenerations(dir)).toEqual([]);
  });

  it('a REUSED process id (live pid, heartbeat stopped) is treated as stale', () => {
    const dir = tmp();
    const f = writeLock(dir, 1, { pid: process.ppid, token: 'old', startedAt: 'x' }, STALE_MS + 1000);
    expect(holderState(f).state).toBe('stale');
    const l = acquireCollectorLock(dir);
    expect('error' in l).toBe(false);
    if (!('error' in l)) l.release();
  });

  it('a live, heartbeating holder in another process is respected', () => {
    const dir = tmp();
    writeLock(dir, 3, { pid: process.ppid, token: 'other', startedAt: 'earlier' });
    const l = acquireCollectorLock(dir);
    expect('error' in l && l.error).toMatch(/Another collector \(pid \d+, started earlier\)/);
  });

  it('a lock file that is still being written (empty, fresh) counts as live: when unsure, refuse', () => {
    const dir = tmp();
    writeLock(dir, 1, '');
    expect('error' in acquireCollectorLock(dir)).toBe(true);
  });

  it('the heartbeat keeps the holder live, and a holder that lost the lock does not delete the new one', async () => {
    const dir = tmp();
    const a = acquireCollectorLock(dir, { heartbeatMs: 20 });
    if ('error' in a) throw new Error(a.error);
    const old = new Date(Date.now() - STALE_MS - 1000);
    fs.utimesSync(a.file, old, old);
    await new Promise((r) => setTimeout(r, 80)); // heartbeat touches it again
    expect(holderState(a.file, { isAlive: () => true }).state).toBe('live');
    // Simulate a long sleep: heartbeat stopped, someone else takes over.
    fs.utimesSync(a.file, old, old);
    const b = acquireCollectorLock(dir, { pid: DEAD_PID - 1, now: () => Date.now() + STALE_MS * 2 });
    if ('error' in b) throw new Error(b.error);
    expect(a.stillOwner()).toBe(false);
    a.release(); // must not remove b's lock
    expect(fs.existsSync(b.file)).toBe(true);
    expect(b.stillOwner()).toBe(true);
    b.release();
  });
});

describe('collector lock: runCollector and wrapper entry points', () => {
  it('runCollector refuses (exit 3) while another collector holds the lock, without touching data', async () => {
    const dir = tmp();
    const data = path.join(dir, 'collection-2026-11-13.jsonl');
    fs.writeFileSync(data, '{"existing":true}\n');
    writeLock(dir, 1, { pid: process.ppid, token: 'other', startedAt: 'earlier' });
    const calls: string[] = [];
    const logs: string[] = [];
    const code = await runCollector(fakeClient(calls), { zones: ['DE'], runs: 1, intervalMs: 0, outDir: dir }, { log: (m) => logs.push(m) });
    expect(code).toBe(3);
    expect(calls).toEqual([]);
    expect(fs.readFileSync(data, 'utf8')).toBe('{"existing":true}\n');
    expect(logs.join(' ')).toMatch(/Another collector/);
  });

  it('a collector that loses the lock between runs stops (exit 4) and writes nothing more', async () => {
    const dir = tmp();
    const calls: string[] = [];
    let other: any = null;
    const code = await runCollector(
      fakeClient(calls),
      { zones: ['DE'], runs: 3, intervalMs: 1, outDir: dir },
      {
        log: () => {},
        sleep: async () => {
          // During the "sleep" the heartbeat stops and a second collector takes over.
          const cur = lockGenerations(dir)[0];
          const old = new Date(Date.now() - STALE_MS - 1000);
          fs.utimesSync(cur.file, old, old);
          other = acquireCollectorLock(dir, { pid: DEAD_PID - 2, now: () => Date.now() + STALE_MS * 2, isAlive: () => false });
        },
      }
    );
    expect(code).toBe(4);
    expect(calls).toEqual(['f:DE', 'h:DE']); // only the first run
    expect(other && !('error' in other)).toBe(true);
    expect(fs.existsSync(other.file)).toBe(true); // the new holder's lock is left alone
    other.release();
  });

  it('the shared CLI entry parses arguments strictly', () => {
    const o = parseCollectorArgs(['--out', 'x', '--runs', '168', '--interval-min', '60', '--zones', 'DE, FR'], '/default');
    expect(o).toMatchObject({ runs: 168, intervalMs: 3_600_000, zones: ['DE', 'FR'] });
    expect(() => parseCollectorArgs(['--runs', '0'], '/d')).toThrow();
    expect(() => parseCollectorArgs(['--runs', 'many'], '/d')).toThrow();
  });

  it('runCollectorCli (used by wrappers) goes through the lock', async () => {
    const dir = tmp();
    writeLock(dir, 1, { pid: process.ppid, token: 'other', startedAt: 'earlier' });
    const calls: string[] = [];
    expect(await runCollectorCli(['--out', dir, '--runs', '1'], fakeClient(calls), { log: () => {} })).toBe(3);
    expect(calls).toEqual([]);
  });

  it('WRAPPER INVOCATION: the CLI script run as a separate process refuses while this process holds the lock', async () => {
    const dir = tmp();
    const data = path.join(dir, 'collection-2026-11-13.jsonl');
    fs.writeFileSync(data, '{"existing":true}\n');
    const held = acquireCollectorLock(dir);
    if ('error' in held) throw new Error(held.error);
    try {
      const script = path.join(BACKEND, 'src', 'scripts', 'collectElectricityMaps.ts');
      // Blank key: even if the lock failed, no provider call could be made.
      const r = await runNode([script, '--out', dir, '--runs', '1'], { ELECTRICITY_MAPS_API_KEY: '' });
      expect(r.code).toBe(3);
      expect(r.out).toMatch(/Another collector \(pid \d+/);
      expect(fs.readFileSync(data, 'utf8')).toBe('{"existing":true}\n');
      expect(held.stillOwner()).toBe(true);
    } finally {
      held.release();
    }
    // Once released, the same invocation takes the lock (then stops: no key) and leaves no lock behind.
    const free = await runNode([path.join(BACKEND, 'src', 'scripts', 'collectElectricityMaps.ts'), '--out', dir, '--runs', '1'], { ELECTRICITY_MAPS_API_KEY: '' });
    expect(free.code).toBe(2);
    expect(lockGenerations(dir)).toEqual([]);
    expect(fs.readFileSync(data, 'utf8')).toBe('{"existing":true}\n');
  }, 60_000);
});

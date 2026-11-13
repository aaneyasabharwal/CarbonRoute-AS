/**
 * Collector folder lock (P7 adversarial review). The lock is a listening socket on 127.0.0.1:<port>
 * (see src/scripts/collectorLock.ts). Regression tests for the defects found in c204f90 and for the
 * adversarial scenarios: simultaneous starts in separate processes (with live, stale, legacy and empty
 * lock files present), SIGKILL, crash, a frozen holder (sleep/resume, delayed heartbeat), clock jumps,
 * fencing of every append, every entry point, and release never affecting another holder.
 * Fake clients only: no provider call, no real data folder.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { acquireCollectorLock, lockKey, lockPort, CollectorLock } from '../../src/scripts/collectorLock';
import { collectOnce, runCollector, runCollectorCli, parseCollectorArgs } from '../../src/scripts/collectElectricityMaps';

const BACKEND = path.resolve(__dirname, '..', '..');
const TS_NODE = require.resolve('ts-node/register/transpile-only', { paths: [BACKEND] });
const CHILD = path.join(BACKEND, 'test', 'support', 'lockChild.ts');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cr-lock-'));
const DEAD_PID = 2 ** 22 + 4321; // above pid_max on Linux and far above any pid on the test machines

/** A port that is free right now (the OS picks it). */
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen({ host: '127.0.0.1', port: 0 }, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

const held: CollectorLock[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (held.length) await held.pop()!.release();
});
async function take(dir: string, port?: number) {
  const l = await acquireCollectorLock(dir, port ? { port } : {});
  if ('error' in l) throw new Error(l.error);
  held.push(l);
  return l;
}

function node(args: string[], env: Record<string, string> = {}) {
  return spawn(process.execPath, ['-r', TS_NODE, ...args], {
    cwd: BACKEND,
    env: { ...process.env, TS_NODE_PROJECT: path.join(BACKEND, 'tsconfig.json'), ELECTRICITY_MAPS_API_KEY: '', ...env },
  });
}
function finished(child: ChildProcess): Promise<{ code: number | null; out: string }> {
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, out })));
}
function waitFor(child: ChildProcess, text: string): Promise<string> {
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout!.on('data', (d) => {
      out += d;
      if (out.includes(text)) resolve(out);
    });
    child.on('close', () => reject(new Error(`child exited before printing "${text}": ${out}`)));
  });
}
async function race(dir: string, port: number | '-', n: number) {
  const startAt = Date.now() + 9000; // every child must have loaded TypeScript before this instant
  const runs = Array.from({ length: n }, () => finished(node([CHILD, 'race', dir, String(port), String(startAt), '1500'])));
  return (await Promise.all(runs)).map((r) => r.out.trim());
}
const count = (outs: string[], s: string) => outs.filter((o) => o === s).length;

describe('mutual exclusion in one process', () => {
  it('a second acquisition of the same folder is refused until the first is released', async () => {
    const dir = tmp();
    const port = await freePort();
    const a = await take(dir, port);
    const b = await acquireCollectorLock(dir, { port });
    expect('error' in b && b.error).toMatch(/Another collector \(pid \d+, started .+\) is writing to/);
    await a.release();
    await a.release(); // idempotent
    expect(a.isOwner()).toBe(false);
    await take(dir, port);
  });

  it('different spellings of the same folder map to the same lock', async () => {
    const dir = tmp();
    await take(dir);
    for (const alias of [dir + path.sep, path.join(dir, '.', '.'), path.join(dir, '..', path.basename(dir))]) {
      expect('error' in (await acquireCollectorLock(alias))).toBe(true);
    }
    if (process.platform === 'win32') expect('error' in (await acquireCollectorLock(dir.toUpperCase()))).toBe(true);
    expect(lockPort(lockKey(dir + path.sep))).toBe(lockPort(lockKey(dir)));
  });

  it('a clock jump changes nothing: the lock does not depend on time', async () => {
    const dir = tmp();
    const port = await freePort();
    await take(dir, port);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 365 * 24 * 3600_000);
    expect('error' in (await acquireCollectorLock(dir, { port }))).toBe(true);
  });

  it('release never affects another holder', async () => {
    const dir = tmp();
    const port = await freePort();
    const a = await take(dir, port);
    await a.release();
    const b = await take(dir, port);
    await a.release(); // stale handle released again
    expect(b.isOwner()).toBe(true);
    expect('error' in (await acquireCollectorLock(dir, { port }))).toBe(true);
  });

  it('a port used by another program is a refusal, never a shared lock', async () => {
    const dir = tmp();
    const port = await freePort();
    const other = net.createServer((s) => s.end('HTTP/1.1 200 OK\r\n\r\n')).listen({ host: '127.0.0.1', port });
    await new Promise((r) => other.once('listening', r));
    try {
      const r = await acquireCollectorLock(dir, { port, identifyTimeoutMs: 500 });
      expect('error' in r && r.error).toMatch(/in use by another program/);
    } finally {
      await new Promise((r) => other.close(r));
    }
  });
});

describe('simultaneous starts in separate processes (8 at the same instant)', () => {
  it('no lock files: exactly one acquires', async () => {
    const outs = await race(tmp(), await freePort(), 8);
    expect([count(outs, 'acquired'), count(outs, 'refused')]).toEqual([1, 7]);
  }, 90_000);

  it('stale (dead) and EMPTY old-style lock files present: still exactly one acquires, and none are deleted', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.collector.lock.4'), JSON.stringify({ pid: DEAD_PID, token: 'x', startedAt: 'x' }));
    fs.writeFileSync(path.join(dir, '.collector.lock.5'), '');
    fs.writeFileSync(path.join(dir, '.collector.lock'), JSON.stringify({ pid: DEAD_PID }));
    const outs = await race(dir, await freePort(), 8);
    expect([count(outs, 'acquired'), count(outs, 'refused')]).toEqual([1, 7]);
    expect(fs.readdirSync(dir).sort()).toEqual(['.collector.lock', '.collector.lock.4', '.collector.lock.5']);
  }, 90_000);

  it('a LIVE holder in another process: none of 8 simultaneous starters acquires', async () => {
    const dir = tmp();
    const port = await freePort();
    await take(dir, port);
    const outs = await race(dir, port, 8);
    expect(count(outs, 'refused')).toBe(8);
  }, 90_000);

  it('an old-style lock file naming a LIVE process (a collector still on the previous version) blocks all starters', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.collector.lock.1'), JSON.stringify({ pid: process.pid, token: 'x', startedAt: 'x' }));
    const outs = await race(dir, await freePort(), 4);
    expect(count(outs, 'refused')).toBe(4);
  }, 90_000);
});

describe('holder failures', () => {
  it('SIGKILL: the operating system frees the lock at once; no stale state remains', async () => {
    const dir = tmp();
    const port = await freePort();
    const child = node([CHILD, 'hold', dir, String(port)]);
    await waitFor(child, 'acquired');
    expect('error' in (await acquireCollectorLock(dir, { port }))).toBe(true);
    const closed = finished(child);
    child.kill('SIGKILL');
    await closed;
    await take(dir, port);
  }, 60_000);

  it('crash (uncaught exception): the lock is freed with the process', async () => {
    const dir = tmp();
    const port = await freePort();
    const r = await finished(node([CHILD, 'crash', dir, String(port)]));
    expect(r.out).toMatch(/acquired/);
    expect(r.code).not.toBe(0);
    await take(dir, port);
  }, 60_000);

  it('FROZEN holder (sleep/resume, stalled loop, late heartbeat): it is never taken over, and still owns the lock afterwards', async () => {
    const dir = tmp();
    const port = await freePort();
    const child = node([CHILD, 'freeze', dir, String(port), '5000']);
    const done = finished(child);
    await waitFor(child, 'acquired');
    for (let i = 0; i < 3; i++) {
      const r = await acquireCollectorLock(dir, { port, identifyTimeoutMs: 400 });
      expect('error' in r).toBe(true); // refused while the holder is alive but unresponsive
      await new Promise((res) => setTimeout(res, 600));
    }
    const r = await done;
    expect(r.out).toMatch(/still-owner true/);
    await take(dir, port);
  }, 60_000);
});

describe('fencing: a process that no longer holds the lock never appends', () => {
  const recorder = (onCall: (zone: string, kind: string) => void) =>
    ({
      isConfigured: () => true,
      getForecast: async (z: string) => (onCall(z, 'forecast'), { ok: true }),
      getHistory: async (z: string) => (onCall(z, 'history'), { observations: [] }),
    }) as any;

  it('ownership lost in the middle of a run: no record after the loss (c204f90 appended 4)', async () => {
    const dir = tmp();
    const lock = await take(dir, await freePort());
    let lossAfter = -1;
    const file = () => path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.jsonl'))!);
    const r = await collectOnce(
      recorder((zone, kind) => {
        if (zone === 'GB' && kind === 'forecast') {
          lossAfter = fs.readFileSync(file(), 'utf8').trim().split('\n').length;
          void lock.release();
        }
      }),
      ['DE', 'GB', 'FR'],
      1,
      dir,
      lock
    );
    expect(r.lost).toBe(true);
    expect(lossAfter).toBe(2);
    expect(fs.readFileSync(file(), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('existing data is only appended to, never rewritten', async () => {
    const dir = tmp();
    const day = new Date().toISOString().slice(0, 10);
    const f = path.join(dir, `collection-${day}.jsonl`);
    fs.writeFileSync(f, '{"existing":true}\n');
    const code = await runCollector(recorder(() => {}), { zones: ['DE'], runs: 1, intervalMs: 0, outDir: dir }, { log: () => {}, lock: { port: await freePort() } });
    expect(code).toBe(0);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    expect(lines[0]).toBe('{"existing":true}');
    expect(lines).toHaveLength(3);
  });

  it('runCollector refuses (exit 3) without any provider call while another collector holds the lock', async () => {
    const dir = tmp();
    const port = await freePort();
    await take(dir, port);
    const calls: string[] = [];
    const code = await runCollector(recorder((z, k) => calls.push(`${k}:${z}`)), { zones: ['DE'], runs: 1, intervalMs: 0, outDir: dir }, { log: () => {}, lock: { port } });
    expect(code).toBe(3);
    expect(calls).toEqual([]);
  });
});

describe('every entry point uses the same lock', () => {
  it('npm run collect (the CLI script, separate process) refuses while another process holds the folder', async () => {
    const dir = tmp();
    const data = path.join(dir, 'collection-2026-11-13.jsonl');
    fs.writeFileSync(data, '{"existing":true}\n');
    await take(dir); // derived port, exactly as the CLI derives it
    const r = await finished(node([path.join(BACKEND, 'src', 'scripts', 'collectElectricityMaps.ts'), '--out', dir, '--runs', '1']));
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/Another collector \(pid \d+/);
    expect(fs.readFileSync(data, 'utf8')).toBe('{"existing":true}\n');
  }, 60_000);

  it('a WRAPPER that delegates to runCollectorCli (like em-collector.cjs) refuses too', async () => {
    const dir = tmp();
    await take(dir);
    const r = await finished(node([path.join(BACKEND, 'test', 'support', 'wrapperChild.ts'), dir, '1']));
    expect(r.code).toBe(3);
  }, 60_000);

  it('runCollectorCli in-process goes through the lock', async () => {
    const dir = tmp();
    await take(dir);
    expect(await runCollectorCli(['--out', dir, '--runs', '1'], { isConfigured: () => true } as any, { log: () => {} })).toBe(3);
  });

  it('no other source file writes collection files or calls collectOnce', () => {
    const src = path.join(BACKEND, 'src');
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
    walk(src);
    const offenders = files.filter((f) => {
      if (f.endsWith(path.join('scripts', 'collectElectricityMaps.ts'))) return false;
      const t = fs.readFileSync(f, 'utf8');
      return /collectOnce\(/.test(t) || /collection-\$\{/.test(t);
    });
    expect(offenders).toEqual([]);
    const self = fs.readFileSync(path.join(src, 'scripts', 'collectElectricityMaps.ts'), 'utf8');
    expect(self.match(/appendFileSync/g)).toHaveLength(1);
    expect(self).toMatch(/if \(!lock\.isOwner\(\)\) return \{[^}]*lost: true \};\n\s*fs\.appendFileSync/);
  });

  it('the CLI parses arguments strictly', () => {
    expect(parseCollectorArgs(['--out', 'x', '--runs', '168', '--interval-min', '60', '--zones', 'DE, FR'], '/d')).toMatchObject({ runs: 168, intervalMs: 3_600_000, zones: ['DE', 'FR'] });
    expect(() => parseCollectorArgs(['--runs', '0'], '/d')).toThrow();
    // No environment override exists: the port depends on the folder only.
    expect(lockPort('k')).toBe(lockPort('k'));
    expect(lockPort('k')).toBeGreaterThanOrEqual(20_000);
    expect(lockPort('k')).toBeLessThan(30_000);
  });
});

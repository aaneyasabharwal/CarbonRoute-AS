#!/usr/bin/env node
/**
 * Adversarial multi-process stress test for the collector lock (P7 review). Needs a build:
 *   cd backend && npm run build && node test/stress/collectorLockStress.cjs [rounds=50] [procs=10] [roundMs=2000]
 *
 * Each round: a fresh temporary folder (sometimes seeded with stale, empty or dead-pid old-style lock
 * files), <procs> processes started at the same instant that repeatedly try to take the lock for
 * <roundMs>. A holder stays inside a critical section for a random time (sometimes blocking its event
 * loop to model sleep or a stalled process), then leaves and releases. The parent SIGKILLs random
 * holders mid-section.
 *
 * Oracle (independent of the lock): on entering the critical section a holder creates `occupant`
 * exclusively (wx). If it already exists and names a process that is still alive, two processes hold
 * the lock at once: a VIOLATION. A leftover from a killed process (dead pid) is removed. Exits 1 on
 * any violation. Never touches real data.
 *
 * Oracle self-check: STRESS_BROKEN_LOCK=1 replaces the lock with one that always grants; the run must
 * then report violations (proves the oracle can detect overlap).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK = path.resolve(__dirname, '..', '..', 'dist', 'scripts', 'collectorLock.js');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function child(dir, port, startAt, until) {
  const acquireCollectorLock = process.env.STRESS_BROKEN_LOCK === '1'
    ? async () => ({ isOwner: () => true, release: async () => {} })
    : require(LOCK).acquireCollectorLock;
  const occ = path.join(dir, 'occupant');
  let acquired = 0;
  let violations = 0;
  await sleep(Math.max(0, startAt - Date.now() - 20));
  while (Date.now() < startAt) {}
  while (Date.now() < until) {
    const l = await acquireCollectorLock(dir, { port, identifyTimeoutMs: 300 });
    if ('error' in l) {
      await sleep(Math.random() * 5);
      continue;
    }
    acquired++;
    // Enter the critical section (oracle).
    for (;;) {
      try {
        fs.writeFileSync(occ, String(process.pid), { flag: 'wx' });
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const other = Number(fs.readFileSync(occ, 'utf8'));
        let stillAlive = other && alive(other);
        for (let i = 0; stillAlive && i < 20; i++) {
          await sleep(10); // a killed process may take a moment to be reaped
          stillAlive = alive(other);
        }
        if (stillAlive) {
          violations++;
          process.stdout.write(`VIOLATION ${process.pid} entered while ${other} inside\n`);
          break;
        }
        fs.rmSync(occ, { force: true });
      }
    }
    if (!l.isOwner()) {
      violations++;
      process.stdout.write(`VIOLATION ${process.pid} lost ownership inside the section\n`);
    }
    process.stdout.write(`IN ${process.pid}\n`);
    const r = Math.random();
    if (r < 0.2) {
      const t = Date.now() + 20 + Math.random() * 80; // frozen event loop
      while (Date.now() < t) {}
    } else {
      await sleep(Math.random() * 25);
    }
    if (fs.existsSync(occ) && fs.readFileSync(occ, 'utf8') === String(process.pid)) fs.rmSync(occ, { force: true });
    await l.release();
    await sleep(Math.random() * 10);
  }
  process.stdout.write(`DONE ${acquired} ${violations}\n`);
  process.exit(0);
}

async function parent() {
  const rounds = Number(process.argv[2] || 50);
  const procs = Number(process.argv[3] || 10);
  const roundMs = Number(process.argv[4] || 2000);
  let acquisitions = 0;
  let violations = 0;
  let kills = 0;
  const t0 = Date.now();
  for (let round = 1; round <= rounds; round++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-stress-'));
    const seed = round % 4;
    if (seed === 1) fs.writeFileSync(path.join(dir, '.collector.lock.3'), JSON.stringify({ pid: 2 ** 22 + round, token: 'x', startedAt: 'x' }));
    if (seed === 2) fs.writeFileSync(path.join(dir, '.collector.lock.9'), '');
    if (seed === 3) fs.writeFileSync(path.join(dir, '.collector.lock'), '{not json');
    const port = 30_000 + Math.floor(Math.random() * 20_000);
    const startAt = Date.now() + 700;
    const until = startAt + roundMs;
    const children = Array.from({ length: procs }, () => {
      const c = spawn(process.execPath, [__filename, '--child', dir, String(port), String(startAt), String(until)]);
      c.out = '';
      c.inside = false;
      c.stdout.on('data', (d) => {
        c.out += d;
        const lines = String(d).trim().split('\n');
        c.inside = lines[lines.length - 1].startsWith('IN ');
      });
      c.done = new Promise((r) => c.on('close', r));
      return c;
    });
    // Kill random holders while they are inside the critical section.
    const killer = setInterval(() => {
      const inside = children.filter((c) => c.inside && c.exitCode === null);
      if (inside.length && Math.random() < 0.15) {
        inside[0].kill('SIGKILL');
        kills++;
      }
    }, 40);
    await Promise.all(children.map((c) => c.done));
    clearInterval(killer);
    for (const c of children) {
      acquisitions += (c.out.match(/^IN /gm) || []).length;
      const v = (c.out.match(/^VIOLATION.*$/gm) || []);
      violations += v.length;
      v.forEach((line) => console.log(`round ${round}: ${line}`));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`collector lock stress: ${rounds} rounds x ${procs} processes, ${acquisitions} acquisitions, ${kills} SIGKILLs of holders, ${violations} violations, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(violations ? 1 : 0);
}

if (process.argv[2] === '--child') child(process.argv[3], Number(process.argv[4]), Number(process.argv[5]), Number(process.argv[6]));
else parent();

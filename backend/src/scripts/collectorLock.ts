/**
 * Collector folder lock (P7 review). Exactly one collector may write to a collection folder.
 *
 * Design (race-free without OS file locking):
 *  - The lock is a sequence of generation files `.collector.lock.<n>`; the highest n is current.
 *  - Taking the lock means atomically CREATING the next generation file (`wx`). Only one process can
 *    create `<n+1>`, so two starters that both judged `<n>` stale cannot both win: the loser gets
 *    EEXIST, re-reads, sees a live holder and refuses. Nothing is ever deleted to take a lock, so
 *    there is no delete-then-create window.
 *  - Liveness is a HEARTBEAT: the holder touches its file every HEARTBEAT_MS. A holder is live only if
 *    its file was touched within STALE_MS and its process id still exists. A reused process id (the
 *    old collector died and Windows gave its id to another program) is therefore stale once the
 *    heartbeat stops. A file that is empty or unreadable but recently touched (being written) counts
 *    as live: when unsure, refuse.
 *  - The holder checks it still owns the lock before every collection run (`stillOwner`). A collector
 *    that was suspended (laptop sleep) long enough to be taken over stops instead of writing.
 * Collected `.jsonl` files are never opened by this module.
 */
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export const LOCK_PREFIX = '.collector.lock.';
export const HEARTBEAT_MS = 30_000;
export const STALE_MS = 3 * 60_000;

export interface LockInfo {
  pid: number;
  token: string;
  startedAt: string;
}

export interface LockOptions {
  pid?: number;
  now?: () => number;
  /** Process liveness check (injectable for tests). */
  isAlive?: (pid: number) => boolean;
  staleMs?: number;
  heartbeatMs?: number;
}

export interface CollectorLock {
  file: string;
  info: LockInfo;
  /** True while this lock is still the current generation and carries our token. */
  stillOwner(): boolean;
  /** Stops the heartbeat and removes the lock file if we still own it. Safe to call twice. */
  release(): void;
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM'; // exists, owned by another user
  }
}

export function lockGenerations(dir: string): { gen: number; file: string }[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(LOCK_PREFIX) && /^\d+$/.test(n.slice(LOCK_PREFIX.length)))
    .map((n) => ({ gen: Number(n.slice(LOCK_PREFIX.length)), file: path.join(dir, n) }))
    .sort((a, b) => b.gen - a.gen);
}

function readInfo(file: string): LockInfo | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof v?.pid === 'number' && typeof v?.token === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** 'live' | 'stale' | 'gone' for one generation file. */
export function holderState(file: string, opts: LockOptions = {}): { state: 'live' | 'stale' | 'gone'; info: LockInfo | null } {
  const now = (opts.now ?? Date.now)();
  const staleMs = opts.staleMs ?? STALE_MS;
  const isAlive = opts.isAlive ?? processAlive;
  let mtime: number;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return { state: 'gone', info: null };
  }
  const fresh = now - mtime < staleMs;
  const info = readInfo(file);
  if (!info) return { state: fresh ? 'live' : 'stale', info: null }; // being written, or corrupt and old
  return { state: fresh && isAlive(info.pid) ? 'live' : 'stale', info };
}

export function acquireCollectorLock(dir: string, opts: LockOptions = {}): CollectorLock | { error: string } {
  const pid = opts.pid ?? process.pid;
  const now = opts.now ?? Date.now;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 20; attempt++) {
    const top = lockGenerations(dir)[0];
    if (top) {
      const h = holderState(top.file, opts);
      if (h.state === 'live') {
        const who = h.info ? `pid ${h.info.pid}, started ${h.info.startedAt}` : 'a collector that is starting';
        return { error: `Another collector (${who}) holds ${top.file}. Not starting a second one.` };
      }
      if (h.state === 'gone') continue; // removed while we looked; re-read
    }
    const info: LockInfo = { pid, token: randomBytes(12).toString('hex'), startedAt: new Date(now()).toISOString() };
    const file = path.join(dir, `${LOCK_PREFIX}${(top?.gen ?? 0) + 1}`);
    try {
      fs.writeFileSync(file, JSON.stringify(info), { flag: 'wx' });
    } catch (err: any) {
      if (err?.code === 'EEXIST') continue; // someone else took this generation first
      throw err;
    }
    // Tidy older generations (never needed for correctness).
    for (const g of lockGenerations(dir)) if (g.file !== file && g.gen < (top?.gen ?? 0) + 1) fs.rmSync(g.file, { force: true });
    const stillOwner = () => {
      const current = lockGenerations(dir)[0];
      return !!current && current.file === file && readInfo(file)?.token === info.token;
    };
    const timer = setInterval(() => {
      if (!stillOwner()) return;
      const t = new Date(now());
      try {
        fs.utimesSync(file, t, t);
      } catch {
        /* removed */
      }
    }, heartbeatMs);
    timer.unref?.();
    let released = false;
    return {
      file,
      info,
      stillOwner,
      release: () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        if (stillOwner()) fs.rmSync(file, { force: true });
      },
    };
  }
  return { error: `Could not take the collector lock in ${dir} (too much contention).` };
}

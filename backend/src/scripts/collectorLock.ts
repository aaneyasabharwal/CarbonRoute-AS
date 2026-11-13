/**
 * Collector folder lock (P7 adversarial review). Exactly one collector may write to a collection
 * folder at any time.
 *
 * Mechanism: the OWNER holds a listening TCP socket on 127.0.0.1:<port>, where <port> is derived from
 * the folder's canonical path. The operating system lets only one socket listen on a given address
 * and port, and frees it when the process ends in ANY way (normal exit, crash, SIGKILL, power loss of
 * the process). Consequences:
 *  - Two processes can never both hold the lock, whatever the interleaving: mutual exclusion is
 *    decided by one atomic kernel operation (bind), not by reading and writing files.
 *  - No stale state exists: a dead process holds nothing. There is no heartbeat, no lease, no clock
 *    and no process-id comparison, so sleep/resume, a frozen event loop, clock jumps and process-id
 *    reuse cannot hand the lock to a second process while the first is alive.
 *  - Nothing is ever deleted to take or release the lock, so no process can remove another's lock.
 * Only the exact address 127.0.0.1 is used (Windows allows a DIFFERENT process to bind 0.0.0.0 on the
 * same port, so a wildcard bind would not be exclusive).
 *
 * A refused starter connects to the port to tell the user who holds it. Any program that is not a
 * CarbonRoute collector for the same folder also causes a refusal (safe direction). Two collectors
 * must run on the same machine: the lock does not protect a folder shared over a network or a
 * synchronised drive.
 *
 * Writes are fenced: callers must check `isOwner()` synchronously immediately before each append
 * (see collectOnce). Ownership can only end through `release()` or a socket error in this process,
 * both of which run on this process's own event loop, so a synchronous check-then-append cannot be
 * interleaved with a loss of ownership.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { createHash } from 'crypto';

export const LOCK_HOST = '127.0.0.1';
const PORT_BASE = 20_000;
const PORT_SPAN = 10_000;
const APP = 'carbonroute-collector';

export interface CollectorLock {
  dir: string;
  port: number;
  pid: number;
  startedAt: string;
  /** True from acquisition until release (or an unexpected socket error). */
  isOwner(): boolean;
  /** Gives the lock up. Idempotent. */
  release(): Promise<void>;
}

export interface LockOptions {
  /** Explicit port, for tests only; collectors always derive it from the folder. */
  port?: number;
  /** Time to wait for the holder to identify itself when refused. */
  identifyTimeoutMs?: number;
}

/** Canonical folder identity: real path, case-insensitive on Windows. */
export function lockKey(dir: string): string {
  const real = fs.realpathSync.native(path.resolve(dir));
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * The lock port is derived ONLY from the folder identity. There is deliberately no environment
 * override: two collectors started with different overrides would use different ports and could both
 * run. (Tests pass an explicit port through LockOptions.port.)
 */
export function lockPort(key: string): number {
  return PORT_BASE + (createHash('sha256').update(key).digest().readUInt32BE(0) % PORT_SPAN);
}

/** Pre-P7-review lock files (.collector.lock and .collector.lock.<n>). */
function legacyHolders(dir: string): number[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const n of names) {
    if (!/^\.collector\.lock(\.\d+)?$/.test(n)) continue;
    try {
      const pid = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))?.pid;
      if (Number.isInteger(pid) && pid !== process.pid && pidExists(pid)) pids.push(pid);
    } catch {
      /* unreadable legacy file: ignore */
    }
  }
  return pids;
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/** Asks whoever holds the port to identify itself. */
function identify(port: number, timeoutMs: number): Promise<{ app?: string; key?: string; pid?: number; startedAt?: string } | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: LOCK_HOST, port });
    let buf = '';
    const done = (v: any) => {
      sock.destroy(); // the client closes first, so the holder keeps no TIME_WAIT on its port
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(null));
    sock.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) {
        try {
          done(JSON.parse(buf.slice(0, buf.indexOf('\n'))));
        } catch {
          done(null);
        }
      }
    });
    sock.on('error', () => done(null));
    sock.on('end', () => done(null));
  });
}

export async function acquireCollectorLock(dir: string, opts: LockOptions = {}): Promise<CollectorLock | { error: string }> {
  fs.mkdirSync(dir, { recursive: true });
  const key = lockKey(dir);
  const port = opts.port ?? lockPort(key);

  const legacy = legacyHolders(dir);
  if (legacy.length) {
    return { error: `A collector using the old lock files (pid ${legacy.join(', ')}) is running for ${dir}. Stop it first; not starting a second one.` };
  }

  const startedAt = new Date().toISOString();
  const hello = JSON.stringify({ app: APP, key, pid: process.pid, startedAt }) + '\n';
  const server = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.write(hello);
    sock.on('end', () => sock.end());
  });

  const bound = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    server.once('error', (err) => resolve(err));
    // exclusive: never share the handle with cluster workers. Exact loopback address only.
    server.listen({ host: LOCK_HOST, port, exclusive: true }, () => resolve(null));
  });

  if (bound) {
    if (bound.code !== 'EADDRINUSE') return { error: `Could not take the collector lock on ${LOCK_HOST}:${port} (${bound.code}).` };
    const who = await identify(port, opts.identifyTimeoutMs ?? 2000);
    if (who?.app === APP && who.key === key) {
      return { error: `Another collector (pid ${who.pid}, started ${who.startedAt}) is writing to ${dir}. Not starting a second one.` };
    }
    if (who?.app === APP) {
      return { error: `Lock port ${port} is held by a collector for a different folder (${who.key}). Move one of the folders (rename it) so the ports differ.` };
    }
    return { error: `Lock port ${LOCK_HOST}:${port} is in use by another program or a collector that is not responding. Not starting. If the port belongs to another program, rename the collection folder (the port is derived from its path).` };
  }

  let owned = true;
  server.on('error', () => {
    owned = false;
  });
  server.on('close', () => {
    owned = false;
  });
  server.unref(); // the lock alone never keeps the process alive

  return {
    dir,
    port,
    pid: process.pid,
    startedAt,
    isOwner: () => owned,
    release: () =>
      new Promise<void>((resolve) => {
        if (!owned) return resolve();
        owned = false;
        server.close(() => resolve());
      }),
  };
}

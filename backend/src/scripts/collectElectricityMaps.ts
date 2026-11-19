/**
 * Collects Electricity Maps forecasts and recent history at a fixed interval, for the
 * forecast-accuracy evaluation and the replay benchmark (P2).
 *
 *   npm run collect -- --out <dir> [--zones DE,GB,US-CAL-CISO,IN-NO,FR] [--runs 25] [--interval-min 60]
 *                      [--retry-window-min 45] [--retry-probe-min 2] [--retry-max 2]
 *
 * Only one collector may write to a folder: see collectorLock.ts. Wrappers must call
 * runCollectorCli (or runCollector), never collectOnce directly.
 *
 * Each run makes 2 calls per zone (forecast 24 h, history 24 h) through the project's client,
 * which enforces the server-wide call budget. The API key is read from the environment and is
 * never written or printed. Output: one JSON line per zone/kind/run, outside the repository.
 * Failures are recorded as failures; nothing is filled in.
 *
 * P23/P24: retries. When calls of a run fail for a temporary reason (no network, timeout, provider
 * 5xx or rate limit), only those calls are tried again within the same hour. Every attempt is
 * written, failed or not, with its own runAt and an `attempt` number; the hourly schedule does not
 * drift. Permanent errors (bad key, not in plan, unknown zone) are never retried.
 *
 * P24: the call budget. The client tries every call up to 3 times and each try counts against the
 * budget (120/hour), so P23's 5 retries could use the whole hourly budget during a long outage
 * (seen as QUOTA_GUARD on 2026-11-18). Now:
 * - before the scheduled run and before every retry the collector checks that the provider's host
 *   resolves (a DNS lookup, no API call). When it does not, no API call is made: the scheduled run
 *   writes failure records with code OFFLINE, and retries keep checking every --retry-probe-min
 *   (default 2) minutes until --retry-window-min (default 45) has passed;
 * - at most --retry-max (default 2) retries call the API.
 * Worst case per hour: (1 + 2) x 10 calls x 3 tries = 90 budget units, below 120. Offline: 0.
 */
import fs from 'fs';
import path from 'path';
import type { ElectricityMapsClient } from '../carbon/electricityMaps';
import { acquireCollectorLock, CollectorLock, LockOptions } from './collectorLock';

export interface CollectorOptions {
  zones: string[];
  runs: number;
  intervalMs: number;
  outDir: string;
  /** P24: how long after the scheduled run retries may happen (default 0: no retries). */
  retryWindowMs?: number;
  /** P24: wait between connectivity checks / retries. */
  retryProbeMs?: number;
  /** P24: retries that call the API (each costs budget). */
  retryMax?: number;
}

/** Errors that may succeed later: worth retrying within the same hour (P23). */
export const RETRYABLE_ERROR_CODES = new Set(['NETWORK', 'TIMEOUT', 'UPSTREAM_ERROR', 'RATE_LIMITED', 'OFFLINE']);
export const DEFAULT_RETRY = { windowMin: 45, probeMin: 2, max: 2 };
export const PROVIDER_HOST = 'api.electricitymaps.com';

/** A client that makes no request: used when the network is down, so no budget is spent (P24). */
const offlineClient = (host: string): Client => {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error(`No network: ${host} could not be resolved; no API call was made.`), { code: 'OFFLINE' });
  };
  return { isConfigured: () => true, getForecast: fail, getHistory: fail };
};

/** True when the provider's host resolves within the timeout (no API call, no budget). */
export async function dnsProbe(host = PROVIDER_HOST, timeoutMs = 5000): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dns = require('dns') as typeof import('dns');
  return Promise.race([
    dns.promises.lookup(host).then(() => true, () => false),
    new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs)),
  ]);
}

export type CollectTarget = { zone: string; kind: 'forecast' | 'history' };

type Client = Pick<ElectricityMapsClient, 'getForecast' | 'getHistory' | 'isConfigured'>;

/**
 * One collection run. Requires the folder lock: ownership is checked synchronously immediately
 * before EVERY append (fencing), so a collector that no longer holds the lock never writes another
 * record. Returns lost: true if it stopped for that reason.
 */
export async function collectOnce(
  client: Client,
  zones: string[],
  run: number,
  outDir: string,
  lock: CollectorLock,
  now = () => new Date(),
  /** P23: only these calls (a retry); default every zone and kind. */
  targets?: CollectTarget[],
  /** P23: 1 for the scheduled run, 2.. for retries (written only on retries). */
  attempt = 1
) {
  const runAt = now().toISOString();
  const file = path.join(outDir, `collection-${runAt.slice(0, 10)}.jsonl`);
  let ok = 0;
  let failed = 0;
  const retryable: CollectTarget[] = [];
  const todo = targets ?? zones.flatMap((zone) => (['forecast', 'history'] as const).map((kind) => ({ zone, kind })));
  for (const { zone, kind } of todo) {
    const rec: Record<string, unknown> = { run, runAt, zone, kind, ...(attempt > 1 ? { attempt } : {}) };
    try {
      rec.data = kind === 'forecast' ? await client.getForecast(zone, { horizonHours: 24 }) : await client.getHistory(zone);
      rec.ok = true;
      ok++;
    } catch (err: any) {
      rec.ok = false;
      rec.error = { code: err?.code, apiStatus: err?.apiStatus, message: String(err?.message || err).slice(0, 300) };
      failed++;
      if (RETRYABLE_ERROR_CODES.has(err?.code)) retryable.push({ zone, kind });
    }
    // Fence: no await between this check and the append.
    if (!lock.isOwner()) return { runAt, ok, failed, file, retryable, lost: true };
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  }
  return { runAt, ok, failed, file, lost: false, retryable };
}

export type CollectorDeps = {
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** Lock options (tests choose a port). */
  lock?: LockOptions;
  /** P24: connectivity check before API calls; absent means "always online". */
  probe?: () => Promise<boolean>;
};

/**
 * Exit codes: 0 done, 2 no API key, 3 another collector holds the folder lock, 4 this collector
 * no longer held the lock (released or socket error) and stopped without writing further records.
 */
export async function runCollector(client: Client, opts: CollectorOptions, deps: CollectorDeps = {}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? console.log;
  // The lock comes first, so every start (even a misconfigured one) is checked against it.
  const lock = await acquireCollectorLock(opts.outDir, deps.lock);
  if ('error' in lock) {
    log(lock.error);
    return 3;
  }
  if (!client.isConfigured()) {
    await lock.release();
    log('Electricity Maps key not configured (ELECTRICITY_MAPS_API_KEY); nothing collected.');
    return 2;
  }
  // Exiting frees the lock port in the operating system; nothing else needs cleaning up.
  const onSignal = (code: number) => () => process.exit(code);
  const onInt = onSignal(130);
  const onTerm = onSignal(143);
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    for (let run = 1; run <= opts.runs; run++) {
      if (!lock.isOwner()) {
        log(`[collector] no longer holds the lock for ${opts.outDir} before run ${run}. Stopping without writing.`);
        return 4;
      }
      // P24: no API call (and no budget) while the network is down.
      const online = deps.probe ? await deps.probe() : true;
      const r = await collectOnce(online ? client : offlineClient(PROVIDER_HOST), opts.zones, run, opts.outDir, lock, deps.now);
      if (r.lost) {
        log(`[collector] lock lost during run ${run}; stopped before the next record (${r.ok + r.failed} written this run).`);
        return 4;
      }
      log(`[collector] run ${run}/${opts.runs} at ${r.runAt}: ${r.ok} ok, ${r.failed} failed`);

      // P23/P24: retry temporarily failed calls inside this run's interval, calling the API only
      // when the network is back and at most retryMax times.
      let pending = r.retryable;
      let waited = 0;
      let apiRetries = 0;
      const windowMs = Math.min(opts.retryWindowMs ?? 0, opts.intervalMs);
      const probeMs = opts.retryProbeMs ?? 2 * 60_000;
      const retryMax = opts.retryMax ?? 0;
      if (pending.length > 0 && retryMax > 0 && windowMs > 0) {
        log(`[collector] run ${run}: ${pending.length} call(s) failed temporarily (${online ? 'provider or network error' : 'offline'}); retrying for up to ${Math.round(windowMs / 60_000)} min`);
      }
      while (pending.length > 0 && apiRetries < retryMax && waited + probeMs < windowMs) {
        await sleep(probeMs);
        waited += probeMs;
        if (!lock.isOwner()) {
          log(`[collector] no longer holds the lock for ${opts.outDir} during the retries of run ${run}. Stopping without writing.`);
          return 4;
        }
        if (deps.probe && !(await deps.probe())) continue; // still offline: no call, no record, no budget
        apiRetries++;
        const retry = await collectOnce(client, opts.zones, run, opts.outDir, lock, deps.now, pending, apiRetries + 1);
        if (retry.lost) {
          log(`[collector] lock lost during a retry of run ${run}; stopped before the next record.`);
          return 4;
        }
        log(`[collector] run ${run} retry ${apiRetries}/${retryMax} at ${retry.runAt}: ${retry.ok} ok, ${retry.failed} failed`);
        pending = retry.retryable;
      }
      if (pending.length > 0 && retryMax > 0 && windowMs > 0) {
        log(`[collector] run ${run}: ${pending.length} call(s) still failing (${apiRetries} API retr${apiRetries === 1 ? 'y' : 'ies'}); the next run is at the usual time.`);
      }
      if (run < opts.runs) await sleep(Math.max(0, opts.intervalMs - waited));
    }
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    await lock.release();
  }
  return 0;
}

/** Parses CLI arguments. Shared by `npm run collect` and any wrapper script, so all use the lock. */
export function parseCollectorArgs(argv: string[], defaultOut: string): CollectorOptions {
  const arg = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const runs = Number(arg('runs', '25'));
  const minutes = Number(arg('interval-min', '60'));
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer.');
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--interval-min must be positive.');
  // P24: retry window, probe interval and API retry cap ("--retry-max 0" turns retries off).
  const windowMin = Number(arg('retry-window-min', String(DEFAULT_RETRY.windowMin)));
  const probeMin = Number(arg('retry-probe-min', String(DEFAULT_RETRY.probeMin)));
  const retryMax = Number(arg('retry-max', String(DEFAULT_RETRY.max)));
  if (!Number.isFinite(windowMin) || windowMin < 0) throw new Error('--retry-window-min must be zero or more minutes.');
  if (!Number.isFinite(probeMin) || probeMin <= 0) throw new Error('--retry-probe-min must be positive.');
  if (!Number.isInteger(retryMax) || retryMax < 0) throw new Error('--retry-max must be a whole number, 0 or more.');
  return {
    zones: arg('zones', 'DE,GB,US-CAL-CISO,IN-NO,FR').split(',').map((z) => z.trim()).filter(Boolean),
    runs,
    intervalMs: minutes * 60_000,
    outDir: path.resolve(arg('out', defaultOut)),
    retryWindowMs: windowMin * 60_000,
    retryProbeMs: probeMin * 60_000,
    retryMax,
  };
}

/** The single collector entry point (CLI and wrappers). Returns the exit code. */
export async function runCollectorCli(argv: string[], client?: Client, deps: CollectorDeps = {}): Promise<number> {
  const defaultOut = path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'em-collection');
  const opts = parseCollectorArgs(argv, defaultOut);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const c: Client = client ?? require('../carbon/electricityMaps').electricityMaps;
  // P24: with the real provider client, check connectivity before API calls. An injected client
  // (tests, wrappers) gets no automatic probe, so its behaviour never depends on the network.
  return runCollector(c, opts, client ? deps : { probe: () => dnsProbe(), ...deps });
}

if (require.main === module) {
  runCollectorCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[collector] ${err?.message || err}`);
      process.exit(1);
    }
  );
}

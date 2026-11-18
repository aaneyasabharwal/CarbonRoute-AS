/**
 * Collects Electricity Maps forecasts and recent history at a fixed interval, for the
 * forecast-accuracy evaluation and the replay benchmark (P2).
 *
 *   npm run collect -- --out <dir> [--zones DE,GB,US-CAL-CISO,IN-NO,FR] [--runs 25] [--interval-min 60]
 *                      [--retry-delays-min 2,5,10,10,10 | none]
 *
 * Only one collector may write to a folder: see collectorLock.ts. Wrappers must call
 * runCollectorCli (or runCollector), never collectOnce directly.
 *
 * Each run makes 2 calls per zone (forecast 24 h, history 24 h) through the project's client,
 * which enforces the server-wide call budget. The API key is read from the environment and is
 * never written or printed. Output: one JSON line per zone/kind/run, outside the repository.
 * Failures are recorded as failures; nothing is filled in.
 *
 * P23: retries. When calls of a run fail for a temporary reason (no network, timeout, provider
 * 5xx or rate limit), only those calls are tried again after the delays in --retry-delays-min
 * (default 2,5,10,10,10 minutes, 37 minutes in total, so before the next hourly run). Every attempt
 * is written, failed or not, with its own runAt and an `attempt` number; the hourly schedule does
 * not drift. Permanent errors (bad key, not in plan, unknown zone) are never retried. Worst case
 * 10 + 5 x 10 = 60 calls per hour, inside the 120/hour and 1,500/day budget.
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
  /** P23: delays before each retry of temporarily failed calls (empty: no retries). */
  retryDelaysMs?: number[];
}

/** Errors that may succeed later: worth retrying within the same hour (P23). */
export const RETRYABLE_ERROR_CODES = new Set(['NETWORK', 'TIMEOUT', 'UPSTREAM_ERROR', 'RATE_LIMITED']);
export const DEFAULT_RETRY_DELAYS_MIN = [2, 5, 10, 10, 10];

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
      const r = await collectOnce(client, opts.zones, run, opts.outDir, lock, deps.now);
      if (r.lost) {
        log(`[collector] lock lost during run ${run}; stopped before the next record (${r.ok + r.failed} written this run).`);
        return 4;
      }
      log(`[collector] run ${run}/${opts.runs} at ${r.runAt}: ${r.ok} ok, ${r.failed} failed`);

      // P23: retry temporarily failed calls, inside this run's interval.
      let pending = r.retryable;
      let waited = 0;
      const delays = opts.retryDelaysMs ?? [];
      for (let i = 0; i < delays.length && pending.length > 0; i++) {
        if (waited + delays[i] >= opts.intervalMs) break; // never run into the next scheduled run
        log(`[collector] run ${run}: ${pending.length} call(s) failed temporarily; retry ${i + 1}/${delays.length} in ${Math.round(delays[i] / 60_000)} min`);
        await sleep(delays[i]);
        waited += delays[i];
        if (!lock.isOwner()) {
          log(`[collector] no longer holds the lock for ${opts.outDir} during the retries of run ${run}. Stopping without writing.`);
          return 4;
        }
        const retry = await collectOnce(client, opts.zones, run, opts.outDir, lock, deps.now, pending, i + 2);
        if (retry.lost) {
          log(`[collector] lock lost during a retry of run ${run}; stopped before the next record.`);
          return 4;
        }
        log(`[collector] run ${run} retry ${i + 1} at ${retry.runAt}: ${retry.ok} ok, ${retry.failed} failed`);
        pending = retry.retryable;
      }
      if (pending.length > 0 && delays.length > 0) {
        log(`[collector] run ${run}: ${pending.length} call(s) still failing after the retries; the next run is at the usual time.`);
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
  // P23: "--retry-delays-min none" turns retries off.
  const rawRetry = arg('retry-delays-min', DEFAULT_RETRY_DELAYS_MIN.join(','));
  const retryMin = rawRetry === 'none' ? [] : rawRetry.split(',').map((v) => Number(v.trim()));
  if (retryMin.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('--retry-delays-min must be positive minutes separated by commas, or "none".');
  return {
    zones: arg('zones', 'DE,GB,US-CAL-CISO,IN-NO,FR').split(',').map((z) => z.trim()).filter(Boolean),
    runs,
    intervalMs: minutes * 60_000,
    outDir: path.resolve(arg('out', defaultOut)),
    retryDelaysMs: retryMin.map((m) => m * 60_000),
  };
}

/** The single collector entry point (CLI and wrappers). Returns the exit code. */
export async function runCollectorCli(argv: string[], client?: Client, deps: CollectorDeps = {}): Promise<number> {
  const defaultOut = path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'em-collection');
  const opts = parseCollectorArgs(argv, defaultOut);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const c: Client = client ?? require('../carbon/electricityMaps').electricityMaps;
  return runCollector(c, opts, deps);
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

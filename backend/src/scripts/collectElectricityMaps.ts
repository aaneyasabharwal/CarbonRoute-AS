/**
 * Collects Electricity Maps forecasts and recent history at a fixed interval, for the
 * forecast-accuracy evaluation and the replay benchmark (P2).
 *
 *   npm run collect -- --out <dir> [--zones DE,GB,US-CAL-CISO,IN-NO,FR] [--runs 25] [--interval-min 60]
 *
 * Only one collector may write to a folder: see collectorLock.ts. Wrappers must call
 * runCollectorCli (or runCollector), never collectOnce directly.
 *
 * Each run makes 2 calls per zone (forecast 24 h, history 24 h) through the project's client,
 * which enforces the server-wide call budget. The API key is read from the environment and is
 * never written or printed. Output: one JSON line per zone/kind/run, outside the repository.
 * Failures are recorded as failures; nothing is filled in.
 */
import fs from 'fs';
import path from 'path';
import type { ElectricityMapsClient } from '../carbon/electricityMaps';
import { acquireCollectorLock, LockOptions } from './collectorLock';

export interface CollectorOptions {
  zones: string[];
  runs: number;
  intervalMs: number;
  outDir: string;
}

type Client = Pick<ElectricityMapsClient, 'getForecast' | 'getHistory' | 'isConfigured'>;

export async function collectOnce(client: Client, zones: string[], run: number, outDir: string, now = () => new Date()) {
  const runAt = now().toISOString();
  const file = path.join(outDir, `collection-${runAt.slice(0, 10)}.jsonl`);
  let ok = 0;
  let failed = 0;
  for (const zone of zones) {
    for (const kind of ['forecast', 'history'] as const) {
      const rec: Record<string, unknown> = { run, runAt, zone, kind };
      try {
        rec.data = kind === 'forecast' ? await client.getForecast(zone, { horizonHours: 24 }) : await client.getHistory(zone);
        rec.ok = true;
        ok++;
      } catch (err: any) {
        rec.ok = false;
        rec.error = { code: err?.code, apiStatus: err?.apiStatus, message: String(err?.message || err).slice(0, 300) };
        failed++;
      }
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    }
  }
  return { runAt, ok, failed, file };
}

export type CollectorDeps = {
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** Lock behaviour (tests inject clocks and liveness). */
  lock?: LockOptions;
};

/**
 * Exit codes: 0 done, 2 no API key, 3 another collector holds the folder lock, 4 the lock was
 * lost while running (e.g. after a long sleep another collector took over), so this one stopped.
 */
export async function runCollector(client: Client, opts: CollectorOptions, deps: CollectorDeps = {}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? console.log;
  // The lock comes first, so every start (even a misconfigured one) is checked against it.
  const lock = acquireCollectorLock(opts.outDir, deps.lock);
  if ('error' in lock) {
    log(lock.error);
    return 3;
  }
  if (!client.isConfigured()) {
    lock.release();
    log('Electricity Maps key not configured (ELECTRICITY_MAPS_API_KEY); nothing collected.');
    return 2;
  }
  const onSignal = (code: number) => () => {
    lock.release();
    process.exit(code);
  };
  const onInt = onSignal(130);
  const onTerm = onSignal(143);
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    for (let run = 1; run <= opts.runs; run++) {
      if (!lock.stillOwner()) {
        log(`[collector] lock lost before run ${run}: another collector took over ${opts.outDir}. Stopping without writing.`);
        return 4;
      }
      const r = await collectOnce(client, opts.zones, run, opts.outDir, deps.now);
      log(`[collector] run ${run}/${opts.runs} at ${r.runAt}: ${r.ok} ok, ${r.failed} failed`);
      if (run < opts.runs) await sleep(opts.intervalMs);
    }
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    lock.release();
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
  return {
    zones: arg('zones', 'DE,GB,US-CAL-CISO,IN-NO,FR').split(',').map((z) => z.trim()).filter(Boolean),
    runs,
    intervalMs: minutes * 60_000,
    outDir: path.resolve(arg('out', defaultOut)),
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

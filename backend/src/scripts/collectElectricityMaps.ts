/**
 * Collects Electricity Maps forecasts and recent history at a fixed interval, for the
 * forecast-accuracy evaluation and the replay benchmark (P2).
 *
 *   npm run collect -- --out <dir> [--zones DE,GB,US-CAL-CISO,IN-NO,FR] [--runs 25] [--interval-min 60]
 *
 * Each run makes 2 calls per zone (forecast 24 h, history 24 h) through the project's client,
 * which enforces the server-wide call budget. The API key is read from the environment and is
 * never written or printed. Output: one JSON line per zone/kind/run, outside the repository.
 * Failures are recorded as failures; nothing is filled in.
 */
import fs from 'fs';
import path from 'path';
import type { ElectricityMapsClient } from '../carbon/electricityMaps';

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

/** Lock file that stops a second collector from writing into the same folder (P7). */
export const LOCK_FILE = '.collector.lock';

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM'; // exists but belongs to another user
  }
}

/**
 * Takes the folder lock. Returns a release function, or an error message when another live
 * collector holds it. A lock left by a process that no longer exists (crash, sleep, reboot) is
 * replaced. Collected data files are never touched.
 */
export function acquireCollectorLock(outDir: string, pid = process.pid, now = () => new Date()): { release: () => void } | { error: string } {
  const file = path.join(outDir, LOCK_FILE);
  const content = JSON.stringify({ pid, startedAt: now().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, content, { flag: 'wx' });
      return {
        release: () => {
          try {
            if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === pid) fs.unlinkSync(file);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      let holder: { pid?: number; startedAt?: string } = {};
      try {
        holder = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        /* unreadable lock: treat as stale */
      }
      if (holder.pid && holder.pid !== pid && processAlive(holder.pid)) {
        return { error: `Another collector (pid ${holder.pid}, started ${holder.startedAt ?? 'unknown'}) is writing to ${outDir}. Not starting a second one.` };
      }
      fs.unlinkSync(file); // stale
    }
  }
  return { error: `Could not take the collector lock in ${outDir}.` };
}

export async function runCollector(
  client: Client,
  opts: CollectorOptions,
  deps: { sleep?: (ms: number) => Promise<void>; log?: (msg: string) => void; now?: () => Date } = {}
) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log ?? console.log;
  if (!client.isConfigured()) {
    log('Electricity Maps key not configured (ELECTRICITY_MAPS_API_KEY); nothing collected.');
    return 2;
  }
  fs.mkdirSync(opts.outDir, { recursive: true });
  const lock = acquireCollectorLock(opts.outDir);
  if ('error' in lock) {
    log(lock.error);
    return 3;
  }
  const release = () => lock.release();
  const onInterrupt = () => {
    release();
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);
  try {
    for (let run = 1; run <= opts.runs; run++) {
      const r = await collectOnce(client, opts.zones, run, opts.outDir, deps.now);
      log(`[collector] run ${run}/${opts.runs} at ${r.runAt}: ${r.ok} ok, ${r.failed} failed`);
      if (run < opts.runs) await sleep(opts.intervalMs);
    }
  } finally {
    process.off('SIGINT', onInterrupt);
    release();
  }
  return 0;
}

if (require.main === module) {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { electricityMaps } = require('../carbon/electricityMaps');
  runCollector(electricityMaps, {
    zones: arg('zones', 'DE,GB,US-CAL-CISO,IN-NO,FR').split(',').map((z) => z.trim()).filter(Boolean),
    runs: Number(arg('runs', '25')),
    intervalMs: Number(arg('interval-min', '60')) * 60_000,
    outDir: path.resolve(arg('out', path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'em-collection'))),
  }).then((code) => process.exit(code));
}

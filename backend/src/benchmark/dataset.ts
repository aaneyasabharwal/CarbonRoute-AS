/**
 * Loads forecast snapshots and realized observations collected from Electricity Maps
 * (P2). The collection files are JSON lines written by the collector: one record per zone,
 * kind ("forecast" or "history") and run. They hold real provider data and are kept outside
 * the repository.
 *
 * Nothing is invented: failed calls are counted, realized values keep their quality
 * (measured or provider estimate), and when the same interval was observed several times the
 * most recently fetched value is used (providers revise estimates).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ForecastSnapshot, Observation } from '../carbon/types';

export interface CollectionRecord {
  run: number;
  runAt: string;
  zone: string;
  kind: 'forecast' | 'history';
  ok: boolean;
  data?: any;
  error?: { code?: string; apiStatus?: number; message?: string };
}

export interface RealizedValue {
  datetime: string;
  value: number;
  quality: Observation['quality'];
  fetchedAt: string;
  intervalMinutes: number;
}

export interface ZoneData {
  zone: string;
  snapshots: ForecastSnapshot[];
  /** Latest fetched value per interval start, sorted by time. */
  realized: RealizedValue[];
}

export interface CollectedDataset {
  zones: Record<string, ZoneData>;
  files: string[];
  /** SHA-256 over the input files (names and bytes), for reproducibility. */
  sha256: string;
  records: number;
  failedRecords: number;
}

const MINUTES: Record<string, number> = { hourly: 60, '15_minutes': 15, '5_minutes': 5 };

export function parseCollection(lines: string[]): CollectionRecord[] {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CollectionRecord);
}

export function buildDataset(records: CollectionRecord[], files: string[] = [], sha256 = ''): CollectedDataset {
  const zones: Record<string, ZoneData> = {};
  const realizedMaps: Record<string, Map<string, RealizedValue>> = {};
  let failed = 0;
  for (const r of records) {
    if (!r.ok || !r.data) {
      failed++;
      continue;
    }
    const z = (zones[r.zone] ??= { zone: r.zone, snapshots: [], realized: [] });
    if (r.kind === 'forecast') {
      z.snapshots.push(r.data as ForecastSnapshot);
    } else {
      const m = (realizedMaps[r.zone] ??= new Map());
      for (const o of (r.data.observations || []) as Observation[]) {
        if (!(typeof o.carbonIntensity === 'number' && Number.isFinite(o.carbonIntensity))) continue;
        const prev = m.get(o.datetime);
        if (!prev || prev.fetchedAt < o.fetchedAt) {
          m.set(o.datetime, {
            datetime: o.datetime,
            value: o.carbonIntensity,
            quality: o.quality,
            fetchedAt: o.fetchedAt,
            intervalMinutes: MINUTES[o.granularity] ?? 60,
          });
        }
      }
    }
  }
  for (const [zone, m] of Object.entries(realizedMaps)) {
    zones[zone].realized = [...m.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));
  }
  for (const z of Object.values(zones)) {
    // One snapshot per distinct forecast (identical re-fetches add nothing).
    const seen = new Set<string>();
    z.snapshots = z.snapshots
      .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))
      .filter((s) => {
        const key = s.rawSha256 || `${s.issuedAt}|${s.fetchedAt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  return { zones, files, sha256, records: records.length, failedRecords: failed };
}

/** Reads every *.jsonl file in a directory (sorted by name). */
export function loadCollectedDataset(dir: string): CollectedDataset {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  const hash = crypto.createHash('sha256');
  const records: CollectionRecord[] = [];
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(dir, f));
    hash.update(f).update(bytes);
    records.push(...parseCollection(bytes.toString('utf8').split('\n')));
  }
  return buildDataset(records, files, hash.digest('hex'));
}

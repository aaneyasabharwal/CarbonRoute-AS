/**
 * Forecast-error dataset (P5, plan M12.2).
 *
 * One row per (forecast snapshot, forecast hour) whose realized value is known:
 *   target   = realized intensity (latest revision; quality kept: measured / provider-estimate)
 *   forecast = the provider's forecast for that hour, as fetched
 *   features available AT FETCH TIME ONLY:
 *     zone, lead hours, target hour of day (UTC), forecast value,
 *     last realized value that was already known when the forecast was fetched (taken from the
 *     history fetched in the SAME collection run, for an hour that had ended by then).
 * Using a later revision or a later hour as a feature would leak the future; this is checked
 * by assertNoLeakage and by tests.
 */
import type { CollectionRecord } from '../benchmark/dataset';

const HOUR = 3600_000;
/** History fetched within this time of the forecast counts as "known at fetch time" (same run). */
const SAME_RUN_TOLERANCE_MS = 5 * 60_000;

export interface ErrorRow {
  zone: string;
  /** When the forecast was fetched (the information time). */
  issuedAt: number;
  /** Start of the forecast hour. */
  targetTime: number;
  leadHours: number;
  hourOfDayUtc: number;
  forecast: number;
  /** Last realized value known at issue time, or null. */
  lastRealized: number | null;
  /** End of the hour that lastRealized describes (must be <= issuedAt). */
  lastRealizedEnd: number | null;
  actual: number;
  quality: 'measured' | 'provider-estimate';
}

export function buildErrorRows(records: CollectionRecord[]): ErrorRow[] {
  // Latest revision of each realized hour (the target).
  const latest = new Map<string, { value: number; quality: ErrorRow['quality']; fetchedAt: string }>();
  // History known at each run, per zone, for the lag feature.
  const historyByRun = new Map<string, { t: number; value: number }[]>();
  for (const r of records) {
    if (!r.ok || !r.data || r.kind !== 'history') continue;
    const key = `${r.zone}|${r.run}|${r.runAt}`;
    const list = historyByRun.get(key) ?? [];
    for (const o of r.data.observations || []) {
      if (o.granularity !== 'hourly' || !Number.isFinite(o.carbonIntensity)) continue;
      // Keyed by the instant, not the string: "…T13:00:00Z" and "…T13:00:00.000Z" are the same hour.
      const k = `${r.zone}|${Date.parse(o.datetime)}`;
      const prev = latest.get(k);
      if (!prev || prev.fetchedAt < o.fetchedAt) latest.set(k, { value: o.carbonIntensity, quality: o.quality, fetchedAt: o.fetchedAt });
      list.push({ t: Date.parse(o.datetime), value: o.carbonIntensity });
    }
    historyByRun.set(key, list);
  }

  const rows: ErrorRow[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!r.ok || !r.data || r.kind !== 'forecast' || r.data.granularity !== 'hourly') continue;
    const issuedAt = Date.parse(r.data.fetchedAt);
    const snapKey = r.data.rawSha256 || `${r.zone}|${r.data.fetchedAt}`;
    if (seen.has(snapKey)) continue;
    seen.add(snapKey);
    const fetchHour = Math.floor(issuedAt / HOUR) * HOUR;
    // Lag feature: latest hour that had ENDED by issue time, from history fetched in the same run.
    const known = (historyByRun.get(`${r.zone}|${r.run}|${r.runAt}`) || [])
      .filter((h) => h.t + HOUR <= issuedAt + SAME_RUN_TOLERANCE_MS && Math.abs(Date.parse(r.runAt) - issuedAt) <= SAME_RUN_TOLERANCE_MS)
      .filter((h) => h.t + HOUR <= issuedAt)
      .sort((a, b) => b.t - a.t)[0];
    for (const p of r.data.points || []) {
      const t = Date.parse(p.datetime);
      const lead = Math.round((t - fetchHour) / HOUR);
      if (lead < 0 || !Number.isFinite(p.carbonIntensity)) continue;
      const target = latest.get(`${r.zone}|${t}`);
      if (!target) continue;
      rows.push({
        zone: r.zone,
        issuedAt,
        targetTime: t,
        leadHours: lead,
        hourOfDayUtc: new Date(t).getUTCHours(),
        forecast: p.carbonIntensity,
        lastRealized: known ? known.value : null,
        lastRealizedEnd: known ? known.t + HOUR : null,
        actual: target.value,
        quality: target.quality,
      });
    }
  }
  return rows.sort((a, b) => a.issuedAt - b.issuedAt || a.zone.localeCompare(b.zone) || a.targetTime - b.targetTime);
}

/** Throws if any feature uses information from after the issue time. */
export function assertNoLeakage(rows: ErrorRow[]): void {
  for (const r of rows) {
    if (r.lastRealizedEnd !== null && r.lastRealizedEnd > r.issuedAt) {
      throw new Error(`Leakage: lag feature for ${r.zone} ends after the issue time.`);
    }
    if (r.targetTime + HOUR <= r.issuedAt - HOUR) throw new Error(`Leakage: target ${r.zone} hour is in the past at issue time.`);
  }
}

export interface ChronologicalSplit {
  train: ErrorRow[];
  validation: ErrorRow[];
  test: ErrorRow[];
  /** Rows dropped so that no target hour of an earlier split overlaps a later split's issue times. */
  droppedForGap: number;
  boundaries: { validationStart: string | null; testStart: string | null };
}

/**
 * Chronological split by issue time. A row belongs to train only if its TARGET hour ended
 * before validation starts (and likewise for validation vs test), so a later split never
 * contains information an earlier split's targets could have used.
 */
export function chronologicalSplit(rows: ErrorRow[], fractions = { train: 0.6, validation: 0.2 }): ChronologicalSplit {
  const issues = [...new Set(rows.map((r) => r.issuedAt))].sort((a, b) => a - b);
  if (issues.length < 3) return { train: [], validation: [], test: [], droppedForGap: rows.length, boundaries: { validationStart: null, testStart: null } };
  const vStart = issues[Math.min(issues.length - 2, Math.max(1, Math.floor(issues.length * fractions.train)))];
  const tStart = issues[Math.min(issues.length - 1, Math.max(Math.floor(issues.length * (fractions.train + fractions.validation)), issues.indexOf(vStart) + 1))];
  const train = rows.filter((r) => r.issuedAt < vStart && r.targetTime + HOUR <= vStart);
  const validation = rows.filter((r) => r.issuedAt >= vStart && r.issuedAt < tStart && r.targetTime + HOUR <= tStart);
  const test = rows.filter((r) => r.issuedAt >= tStart);
  return {
    train,
    validation,
    test,
    droppedForGap: rows.length - train.length - validation.length - test.length,
    boundaries: { validationStart: new Date(vStart).toISOString(), testStart: new Date(tStart).toISOString() },
  };
}

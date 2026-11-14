/**
 * Forecast accuracy on collected data (P2, plan M8.4): each forecast point is compared with
 * the realized value for the same interval, when one exists. Lead time is measured from the
 * start of the hour in which CarbonRoute fetched the forecast (when the information was
 * available to the scheduler). Pairs are split by the quality of the realized value: a
 * provider ESTIMATE is not a measurement, so measured-only metrics are reported separately.
 */
import { errorMetrics, ErrorMetrics } from '../evaluation/metrics';
import type { CollectedDataset } from './dataset';

const HOUR = 3600_000;

export const LEAD_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0-5 h', min: 0, max: 5 },
  { label: '6-11 h', min: 6, max: 11 },
  { label: '12-23 h', min: 12, max: 23 },
  { label: '24+ h', min: 24, max: Infinity },
];

/** Minimum pairs before an empirical error band is reported (P2 uncertainty validation). */
export const MIN_PAIRS_FOR_ERROR_BAND = 30;

export interface ErrorBand {
  bucket: string;
  n: number;
  status: 'ok' | 'insufficient-data';
  /** Empirical quantiles of (forecast - realized); null when status is insufficient-data. */
  p05: number | null;
  p50: number | null;
  p95: number | null;
}

/**
 * Empirical forecast-error band per lead-time bucket. This is the only forecast uncertainty
 * CarbonRoute reports for live data: Electricity Maps forecasts carry none, and nothing is
 * assumed. With fewer than MIN_PAIRS_FOR_ERROR_BAND pairs the band is not reported.
 */
export function errorBands(pairs: { leadHours: number; forecast: number; actual: number }[]): ErrorBand[] {
  return LEAD_BUCKETS.map((b) => {
    const errs = pairs
      .filter((p) => p.leadHours >= b.min && p.leadHours <= b.max)
      .map((p) => p.forecast - p.actual)
      .sort((x, y) => x - y);
    const q = (p: number) => errs[Math.min(errs.length - 1, Math.max(0, Math.floor(p * errs.length)))];
    return errs.length < MIN_PAIRS_FOR_ERROR_BAND
      ? { bucket: b.label, n: errs.length, status: 'insufficient-data' as const, p05: null, p50: null, p95: null }
      : { bucket: b.label, n: errs.length, status: 'ok' as const, p05: q(0.05), p50: q(0.5), p95: q(0.95) };
  });
}

export interface ZoneAccuracy {
  zone: string;
  snapshots: number;
  pairs: number;
  all: ErrorMetrics;
  measuredOnly: ErrorMetrics;
  estimatedOnly: ErrorMetrics;
  byLead: { bucket: string; metrics: ErrorMetrics }[];
  errorBands: ErrorBand[];
}

export interface ForecastPair {
  zone: string;
  datetime: string;
  leadHours: number;
  forecast: number;
  actual: number;
  quality: 'measured' | 'provider-estimate';
  snapshotFetchedAt: string;
}

export function forecastPairs(dataset: CollectedDataset): ForecastPair[] {
  const pairs: ForecastPair[] = [];
  for (const z of Object.values(dataset.zones)) {
    const realized = new Map(z.realized.map((r) => [Date.parse(r.datetime), r]));
    for (const s of z.snapshots) {
      const fetchHour = Math.floor(Date.parse(s.fetchedAt) / HOUR) * HOUR;
      for (const p of s.points) {
        const t = Date.parse(p.datetime);
        const lead = Math.round((t - fetchHour) / HOUR);
        if (lead < 0) continue; // not a forecast: the interval was already over when fetched
        const r = realized.get(t);
        if (!r || r.intervalMinutes !== 60) continue;
        pairs.push({ zone: z.zone, datetime: p.datetime, leadHours: lead, forecast: p.carbonIntensity, actual: r.value, quality: r.quality, snapshotFetchedAt: s.fetchedAt });
      }
    }
  }
  return pairs;
}

export function forecastAccuracy(dataset: CollectedDataset): { zones: ZoneAccuracy[]; overall: ErrorMetrics; measuredOnly: ErrorMetrics } {
  const pairs = forecastPairs(dataset);
  const zones = Object.values(dataset.zones).map((z) => {
    const zp = pairs.filter((p) => p.zone === z.zone);
    return {
      zone: z.zone,
      snapshots: z.snapshots.length,
      pairs: zp.length,
      all: errorMetrics(zp),
      measuredOnly: errorMetrics(zp.filter((p) => p.quality === 'measured')),
      estimatedOnly: errorMetrics(zp.filter((p) => p.quality === 'provider-estimate')),
      byLead: LEAD_BUCKETS.map((b) => ({ bucket: b.label, metrics: errorMetrics(zp.filter((p) => p.leadHours >= b.min && p.leadHours <= b.max)) })),
      errorBands: errorBands(zp),
    };
  });
  return { zones, overall: errorMetrics(pairs), measuredOnly: errorMetrics(pairs.filter((p) => p.quality === 'measured')) };
}

/**
 * Forecast-vs-observation evaluation (pure functions, no I/O).
 *
 * Rules:
 *  - An error is computed only for an interval that has BOTH a forecast value and an
 *    observation for the same interval start. Unmatched intervals are listed, not filled.
 *  - Measured observations and provider estimates are evaluated separately. Comparing a
 *    forecast with a provider estimate measures model-vs-model agreement, not error against
 *    a measurement, and is labelled that way.
 *  - error = forecast - observed (positive bias = forecast too high), in gCO2eq/kWh.
 */
import type { ForecastPoint, Observation, ObservationQuality } from '../carbon/types';

export interface MatchedPair {
  datetime: string;
  forecast: number;
  observed: number;
  error: number;
  quality: ObservationQuality;
  isEstimated: boolean;
  estimationMethod: string | null;
}

export interface ErrorMetrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  unit: 'gCO2eq/kWh';
}

export interface ForecastEvaluation {
  pairs: MatchedPair[];
  unmatchedIntervals: string[];
  /** Forecast vs measured observations (true forecast error). Null when there are none. */
  measured: ErrorMetrics | null;
  /** Forecast vs provider estimates (model-vs-model agreement). Null when there are none. */
  providerEstimate: ErrorMetrics | null;
}

export function errorMetrics(errors: number[]): ErrorMetrics | null {
  if (errors.length === 0) return null;
  const n = errors.length;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    n,
    mae: round(errors.reduce((s, e) => s + Math.abs(e), 0) / n),
    rmse: round(Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / n)),
    bias: round(errors.reduce((s, e) => s + e, 0) / n),
    unit: 'gCO2eq/kWh',
  };
}

export function evaluateForecast(intervals: string[], forecast: ForecastPoint[], observations: Observation[]): ForecastEvaluation {
  const f = new Map(forecast.map((p) => [p.datetime, p.carbonIntensity]));
  const o = new Map(observations.map((x) => [x.datetime, x]));
  const pairs: MatchedPair[] = [];
  const unmatchedIntervals: string[] = [];
  for (const t of intervals) {
    const fv = f.get(t);
    const ov = o.get(t);
    if (fv === undefined || ov === undefined) {
      unmatchedIntervals.push(t);
      continue;
    }
    pairs.push({
      datetime: t,
      forecast: fv,
      observed: ov.carbonIntensity,
      error: fv - ov.carbonIntensity,
      quality: ov.quality,
      isEstimated: ov.isEstimated,
      estimationMethod: ov.estimationMethod,
    });
  }
  return {
    pairs,
    unmatchedIntervals,
    measured: errorMetrics(pairs.filter((p) => p.quality === 'measured').map((p) => p.error)),
    providerEstimate: errorMetrics(pairs.filter((p) => p.quality === 'provider-estimate').map((p) => p.error)),
  };
}

export type RealizedQuality = 'measured' | 'provider-estimate' | 'mixed';

export interface RealizedWindow {
  /** Average observed intensity over the window; null unless every interval was observed. */
  averageIntensity: number | null;
  /** Observed emissions for the assumed energy use; null unless every interval was observed. */
  emissionsGrams: number | null;
  quality: RealizedQuality | null;
  coverage: { observed: number; expected: number };
  reason: string;
}

/**
 * Realized intensity/emissions for a window. Only computed when every interval has an
 * observation; otherwise null with the reason (nothing is extrapolated).
 */
export function realizedWindow(intervals: string[], observations: Observation[], energyKwh: number): RealizedWindow {
  const byTime = new Map(observations.map((o) => [o.datetime, o]));
  const found = intervals.map((t) => byTime.get(t)).filter((o): o is Observation => !!o);
  const coverage = { observed: found.length, expected: intervals.length };
  if (intervals.length === 0 || found.length < intervals.length) {
    return {
      averageIntensity: null,
      emissionsGrams: null,
      quality: null,
      coverage,
      reason: `Observations exist for ${found.length} of ${intervals.length} interval(s); realized values are only computed with full coverage.`,
    };
  }
  const avg = found.reduce((s, o) => s + o.carbonIntensity, 0) / found.length;
  const measured = found.filter((o) => o.quality === 'measured').length;
  const quality: RealizedQuality = measured === found.length ? 'measured' : measured === 0 ? 'provider-estimate' : 'mixed';
  return {
    averageIntensity: Math.round(avg * 10) / 10,
    emissionsGrams: Math.round(avg * energyKwh * 10) / 10,
    quality,
    coverage,
    reason:
      quality === 'measured'
        ? 'All intervals are measured observations.'
        : quality === 'provider-estimate'
          ? 'All intervals are Electricity Maps estimates, not measurements.'
          : `${measured} of ${found.length} intervals are measured; the rest are Electricity Maps estimates.`,
  };
}

/** Hourly interval starts (UTC ISO) overlapping [start, end). */
export function hourlyIntervals(startUtc: string, endUtc: string): string[] {
  const start = Math.floor(Date.parse(startUtc) / 3600_000) * 3600_000;
  const end = Date.parse(endUtc);
  const out: string[] = [];
  for (let t = start; t < end; t += 3600_000) out.push(new Date(t).toISOString());
  return out;
}

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
import { timeWeightedAverage, TimeWeightedResult } from './timeWeighting';

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

export type IntensityQuality = 'measured' | 'provider-estimate' | 'mixed';

export interface WindowIntensity {
  window: { startUtc: string; endUtc: string };
  emissionFactorType: string;
  /** Time-weighted forecast intensity from the stored snapshot (gCO2eq/kWh). */
  forecast: TimeWeightedResult & { reason: string };
  /** Time-weighted observed intensity (gCO2eq/kWh); null unless the whole window is observed. */
  observed: TimeWeightedResult & {
    quality: IntensityQuality | null;
    /** Observations ignored because their emission factor differs from the forecast's. */
    excludedForEmissionFactor: string[];
    reason: string;
  };
}

/**
 * Forecast and observed intensity for the same window, both time-weighted by the minutes each
 * interval overlaps the window. Only observations with the forecast's emission-factor type are
 * used. Missing time makes the value null; it is never treated as zero.
 */
export function windowIntensity(
  window: { startUtc: string; endUtc: string },
  forecast: { points: ForecastPoint[]; granularityMinutes: number; emissionFactorType: string },
  observations: Observation[],
  observationGranularityMinutes = 60
): WindowIntensity {
  const fc = timeWeightedAverage(
    window,
    forecast.points.map((p) => ({ datetime: p.datetime, value: p.carbonIntensity, intervalMinutes: forecast.granularityMinutes }))
  );
  const usable = observations.filter((o) => o.emissionFactorType === forecast.emissionFactorType);
  const excluded = observations.filter((o) => o.emissionFactorType !== forecast.emissionFactorType).map((o) => o.datetime);
  const obs = timeWeightedAverage(
    window,
    usable.map((o) => ({ datetime: o.datetime, value: o.carbonIntensity, intervalMinutes: observationGranularityMinutes }))
  );
  const byStart = new Map(usable.map((o) => [new Date(Date.parse(o.datetime)).toISOString(), o]));
  const used = obs.segments.map((sgm) => byStart.get(sgm.intervalStart)!).filter(Boolean);
  const measured = used.filter((o) => o.quality === 'measured').length;
  const quality: IntensityQuality | null = obs.value === null ? null : measured === used.length ? 'measured' : measured === 0 ? 'provider-estimate' : 'mixed';
  const minutes = (m: number) => `${Math.round(m * 100) / 100} min`;
  return {
    window,
    emissionFactorType: forecast.emissionFactorType,
    forecast: {
      ...fc,
      reason: fc.complete ? 'Time-weighted from the stored forecast snapshot.' : `The forecast does not cover ${fc.missing.length} part(s) of the window.`,
    },
    observed: {
      ...obs,
      quality,
      excludedForEmissionFactor: excluded,
      reason:
        obs.value === null
          ? `Observations cover ${minutes(obs.coveredMinutes)} of ${minutes(obs.windowMinutes)}; the observed intensity is only computed when the whole window is covered.`
          : quality === 'measured'
            ? 'Every observed interval is a measurement.'
            : quality === 'provider-estimate'
              ? 'Every observed interval is an Electricity Maps estimate, not a measurement.'
              : `${measured} of ${used.length} observed intervals are measurements; the rest are Electricity Maps estimates.`,
    },
  };
}

export const ESTIMATED_EMISSIONS_LABEL = 'Estimated emissions (assumed energy)';
export const REALIZED_UNAVAILABLE_LABEL = 'Realized emissions unavailable';

export interface EmissionsAssessment {
  /** Only available when energy consumption was actually recorded. */
  realized:
    | { available: true; grams: number; energyKwh: number; energySource: 'recorded'; intensityQuality: IntensityQuality }
    | { available: false; label: typeof REALIZED_UNAVAILABLE_LABEL; reason: string };
  /** Observed intensity x ASSUMED energy. Never a realized or measured emission. */
  estimated: {
    label: typeof ESTIMATED_EMISSIONS_LABEL;
    grams: number | null;
    energyKwh: number;
    energyBasis: string;
    intensityQuality: IntensityQuality | null;
    reason: string;
  };
}

export function assessEmissions(
  observed: { value: number | null; quality: IntensityQuality | null },
  assumedEnergy: { energyKwh: number; basis: string },
  recordedEnergyKwh?: number | null
): EmissionsAssessment {
  const hasRecorded = typeof recordedEnergyKwh === 'number' && Number.isFinite(recordedEnergyKwh) && recordedEnergyKwh > 0;
  const realized: EmissionsAssessment['realized'] =
    hasRecorded && observed.value !== null && observed.quality
      ? {
          available: true,
          grams: Math.round(observed.value * (recordedEnergyKwh as number) * 10) / 10,
          energyKwh: recordedEnergyKwh as number,
          energySource: 'recorded',
          intensityQuality: observed.quality,
        }
      : {
          available: false,
          label: REALIZED_UNAVAILABLE_LABEL,
          reason: !hasRecorded
            ? 'No energy consumption was recorded for this execution (it was simulated and no power measurement exists), so realized emissions cannot be calculated.'
            : 'The observed intensity is not available for the whole window, so realized emissions cannot be calculated.',
        };
  return {
    realized,
    estimated: {
      label: ESTIMATED_EMISSIONS_LABEL,
      grams: observed.value === null ? null : Math.round(observed.value * assumedEnergy.energyKwh * 10) / 10,
      energyKwh: assumedEnergy.energyKwh,
      energyBasis: assumedEnergy.basis,
      intensityQuality: observed.quality,
      reason:
        observed.value === null
          ? 'Not calculable: the observed intensity is not available for the whole window.'
          : 'Observed intensity multiplied by an ASSUMED energy use. This is an estimate, not a measured or realized emission.',
    },
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

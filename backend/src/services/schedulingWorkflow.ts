/**
 * End-to-end scheduling workflow:
 *   job (real deadline) -> forecast snapshot -> all policies -> feasible recommendation
 *   -> persisted decision -> (simulated) execution -> provider observations -> evaluation.
 *
 * Time handling: every timestamp is UTC. The forecast's first point starts at the
 * beginning of the current interval (Electricity Maps returns the current hour, which has
 * already started), so hourly "slot k" starts at forecastStart + k hours, except the slot
 * containing the arrival time, where the job can only start at the arrival time itself.
 */
import { ElectricityMapsClient, electricityMaps } from '../carbon/electricityMaps';
import type { ForecastSnapshot } from '../carbon/types';
import { CarbonService, CarbonForecastData } from './carbonService';
import { SchedulerService, WorkloadJob, SchedulingDecisionResponse } from './schedulerService';
import { schedulingStore, SchedulingStore, StoredDecision, StoredJob, StoredObservationSet, WindowTimes } from '../models/schedulingStore';
import { assessEmissions, evaluateForecast, hourlyIntervals, windowIntensity } from '../evaluation/forecastEvaluation';
import { timeWeightedAverage, parseZonedTimestamp } from '../evaluation/timeWeighting';
import { validateWorkloadSpec } from './workloadSpec';
import { energyAssumption } from './energyModel';
import { MAX_RUNTIME_CV } from './uncertaintyService';

export const ENGINE_VERSION = 'carbonroute-engine-2026-11-p1';
const HOUR = 3600_000;
const HISTORY_WINDOW_HOURS = 24; // Only the last 24 h are readable with the current API plan.

export class WorkflowError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

export interface ScheduleInput {
  jobId?: string;
  /** User who owns the job (M1.2). */
  ownerId?: string;
  name: string;
  commandOrImage: string;
  isContainerImage: boolean;
  zone: string;
  durationHours: number;
  cpu: number;
  memoryMb: number;
  riskTolerance: number;
  /** ISO UTC deadline; alternatively deadlineHours relative to now (legacy input). */
  deadlineAt?: string;
  deadlineHours?: number;
  /** ISO UTC arrival (defaults to now; may not be in the past). */
  arrivalAt?: string;
  /** @deprecated ignored: belonged to the removed deadline-risk model (audit C1). */
  uncertaintyMultiplier?: number;
  /** Declared runtime coefficient of variation, 0 to 1 (0 = deterministic runtime). */
  runtimeCv?: number;
  mode: 'live' | 'demo';
}

// Shared with the engine so both use the same numbers (P1).
export { energyAssumption };

/**
 * Parses an absolute time. P3: a time zone designator (Z or ±hh:mm) is required. Without one,
 * "2026-11-14T18:00" would be read in the SERVER's local time zone, which differs between
 * machines and is not the grid zone's local time; such input is rejected instead of guessed.
 */
function parseIso(value: unknown, field: string): number {
  try {
    return parseZonedTimestamp(String(value), field);
  } catch {
    throw new WorkflowError(
      400,
      `${field} must be an ISO-8601 date-time with a time zone, e.g. 2026-11-14T18:00:00Z or 2026-11-14T19:00:00+01:00.`
    );
  }
}

function validate(input: ScheduleInput, now: number) {
  try {
    validateWorkloadSpec({ commandOrImage: input.commandOrImage, isContainerImage: input.isContainerImage });
  } catch (err: any) {
    throw new WorkflowError(400, err.message, 'INVALID_WORKLOAD');
  }
  const dur = Number(input.durationHours);
  if (!Number.isInteger(dur) || dur < 1 || dur > 72) {
    throw new WorkflowError(400, 'durationHours must be a whole number of hours between 1 and 72.');
  }
  const tau = Number(input.riskTolerance);
  if (!(tau > 0 && tau < 1)) throw new WorkflowError(400, 'riskTolerance must be between 0 and 1 (exclusive).');
  if (!(Number(input.cpu) > 0)) throw new WorkflowError(400, 'cpu must be greater than 0.');
  const runtimeCv = input.runtimeCv === undefined || input.runtimeCv === null || (input.runtimeCv as unknown) === '' ? 0 : Number(input.runtimeCv);
  if (!(Number.isFinite(runtimeCv) && runtimeCv >= 0 && runtimeCv <= MAX_RUNTIME_CV)) {
    throw new WorkflowError(400, `runtimeCv must be between 0 and ${MAX_RUNTIME_CV} (declared runtime coefficient of variation).`);
  }

  let deadline: number;
  if (input.deadlineAt !== undefined && input.deadlineAt !== null && input.deadlineAt !== '') {
    deadline = parseIso(input.deadlineAt, 'deadlineAt');
  } else if (Number(input.deadlineHours) > 0) {
    deadline = now + Number(input.deadlineHours) * HOUR;
  } else {
    throw new WorkflowError(400, 'A deadline is required: deadlineAt (ISO date-time) or deadlineHours (> 0).');
  }
  let arrival = now;
  if (input.arrivalAt) {
    arrival = parseIso(input.arrivalAt, 'arrivalAt');
    if (arrival < now - 5 * 60_000) throw new WorkflowError(400, 'arrivalAt cannot be in the past.');
    arrival = Math.max(arrival, now);
  }
  if (deadline <= arrival) throw new WorkflowError(400, 'The deadline must be after the arrival time.');
  return { dur, tau, deadline, arrival, runtimeCv };
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function demoSnapshot(forecast: CarbonForecastData): ForecastSnapshot {
  return {
    provider: 'synthetic-demo',
    dataClass: 'synthetic',
    zone: forecast.region,
    issuedAt: null,
    fetchedAt: forecast.timestamp,
    horizonHours: forecast.forecastHorizonHours,
    granularity: 'hourly',
    emissionFactorType: 'lifecycle',
    unit: 'gCO2eq/kWh',
    points: forecast.hourlyProfile.map((p) => ({ datetime: new Date(Date.parse(p.timestamp)).toISOString(), carbonIntensity: p.predictedCarbon })),
    endpoint: 'builtin:PreparedTraceDataProvider (synthetic demo profile)',
    rawSha256: null,
  };
}

export async function scheduleWorkflow(
  input: ScheduleInput,
  deps: { now?: () => number; store?: SchedulingStore; getForecast?: typeof CarbonService.getForecast } = {}
) {
  const now = (deps.now ?? Date.now)();
  const store = deps.store ?? schedulingStore();
  const getForecast = deps.getForecast ?? CarbonService.getForecast.bind(CarbonService);
  const { dur, tau, deadline, arrival, runtimeCv } = validate(input, now);
  const zone = input.mode === 'live' ? ElectricityMapsClient.validateZone(input.zone) : String(input.zone || 'BENCHMARK-RESEARCH');
  const energy = energyAssumption(input.cpu, dur);

  const job: StoredJob = store.addJob({
    id: input.jobId,
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    name: input.name,
    commandOrImage: input.commandOrImage,
    isContainerImage: input.isContainerImage,
    zone,
    durationHours: dur,
    cpu: input.cpu,
    memoryMb: input.memoryMb,
    riskTolerance: tau,
    arrivalAt: iso(arrival),
    deadlineAt: iso(deadline),
  });

  const infeasible = (reason: string, snapshotId: string | null, extra: Record<string, unknown> = {}) => {
    const decision = store.addDecision({
      jobId: job.id,
      snapshotId,
      engineVersion: ENGINE_VERSION,
      status: 'INFEASIBLE',
      dataMode: input.mode,
      dataClass: input.mode === 'live' ? 'real' : 'synthetic',
      riskModel: null,
      recommendedWindow: null,
      immediateWindow: null,
      energyAssumption: energy,
      infeasibilityReason: reason,
      result: { reason, ...extra },
    });
    return { status: 'INFEASIBLE' as const, reason, recommendation: null, decisionId: decision.id, snapshotId, job, ...extra };
  };

  // 1. Deadline feasibility before any data is fetched: even starting at arrival is too late.
  if (arrival + dur * HOUR > deadline) {
    return infeasible(
      `A ${dur} h job arriving at ${iso(arrival)} cannot finish before the deadline ${iso(deadline)} (earliest finish ${iso(arrival + dur * HOUR)}).`,
      null
    );
  }

  // 2. Forecast covering the deadline (the smallest supported horizon, at most 72 h).
  const hoursNeeded = Math.ceil((deadline - now) / HOUR) + 1;
  const forecast = await getForecast(zone, Math.min(72, hoursNeeded), input.mode, now);
  const snapshot = store.addSnapshot(forecast.snapshot ?? demoSnapshot(forecast));
  const points = forecast.hourlyProfile;
  const start = Date.parse(points[0].timestamp);
  const coverageEnd = Date.parse(points[points.length - 1].timestamp) + HOUR;

  const arrivalHour = Math.max(0, Math.floor((arrival - start) / HOUR));
  const deadlineHoursFromStart = Math.floor((deadline - start) / HOUR);
  if (arrivalHour + dur > points.length) {
    return infeasible(
      `The forecast only covers until ${iso(coverageEnd)}, which is too short to evaluate even an immediate ${dur} h run.`,
      snapshot.id,
      { status: 'INSUFFICIENT_FORECAST_COVERAGE' }
    );
  }

  const engineJob: WorkloadJob = {
    id: job.id,
    name: job.name,
    commandOrImage: job.commandOrImage,
    isContainerImage: job.isContainerImage,
    durationHours: dur,
    deadlineHours: deadlineHoursFromStart,
    arrivalHour,
    cpu: input.cpu,
    memoryMb: input.memoryMb,
    region: zone,
    riskTolerance: tau,
    status: 'scheduled',
    createdAt: job.createdAt,
  };
  const outcome = SchedulerService.evaluatePolicies(engineJob, forecast, { runtimeCv });
  if (outcome.status !== 'RECOMMENDED') {
    // No fallback (P1): an explicit, stored infeasible decision with the evaluated windows.
    return infeasible(outcome.reason, snapshot.id, {
      status: outcome.status,
      riskModel: outcome.riskModel,
      runtimeCv,
      candidateWindows: outcome.candidateWindows,
      evaluatedPolicies: outcome.evaluatedPolicies,
      unavailablePolicies: outcome.unavailablePolicies,
    });
  }
  const result: SchedulingDecisionResponse = outcome;

  // 3. Wall-clock times for every window, checked against the real deadline.
  const windowTimes = (k: number): WindowTimes => {
    const s = k === arrivalHour ? arrival : start + k * HOUR;
    return { startUtc: iso(s), endUtc: iso(s + dur * HOUR) };
  };
  const meets = (w: WindowTimes) => Date.parse(w.endUtc) <= deadline && Date.parse(w.startUtc) >= arrival;
  // Time-weighted forecast for each policy's actual wall-clock window (a window that starts at
  // the arrival time mid-hour only counts the minutes it overlaps each hour). The engine's
  // hourly-slot values are kept unchanged for ranking and traceability.
  const forecastValues = snapshot.points.map((p) => ({ datetime: p.datetime, value: p.carbonIntensity, intervalMinutes: 60 }));
  const forecastTw = (w: WindowTimes) => timeWeightedAverage(w, forecastValues).value;
  const policies = result.evaluatedPolicies.map((p) => {
    const w = windowTimes(p.selectedStartHour);
    const tw = forecastTw(w);
    return {
      ...p,
      selectedStartUtc: w.startUtc,
      selectedEndUtc: w.endUtc,
      meetsDeadline: meets(w),
      forecastIntensityTimeWeighted: tw,
      estimatedEmissionsAssumedEnergyGrams: tw === null ? null : Math.round(tw * energy.energyKwh * 10) / 10,
    };
  });
  const candidateWindows = result.candidateWindows.map((c) => {
    const w = windowTimes(c.startHour);
    return { ...c, startUtc: w.startUtc, endUtc: w.endUtc };
  });
  const rec = policies.find((p) => p.policyId === result.recommendedDecision.policyId)!;
  if (!rec.meetsDeadline) {
    // Should be impossible by construction; never return an infeasible recommendation.
    throw new WorkflowError(500, 'Internal error: the recommended window does not meet the deadline.');
  }
  const recommendedWindow = { startUtc: rec.selectedStartUtc, endUtc: rec.selectedEndUtc };
  const immediate = policies.find((p) => p.policyId === 'immediate')!;
  const immediateWindow = { startUtc: immediate.selectedStartUtc, endUtc: immediate.selectedEndUtc };

  const response = {
    ...result,
    status: 'RECOMMENDED' as const,
    job: { ...engineJob, ...job },
    evaluatedPolicies: policies,
    candidateWindows,
    recommendedDecision: { ...result.recommendedDecision, selectedStartUtc: recommendedWindow.startUtc, selectedEndUtc: recommendedWindow.endUtc, meetsDeadline: true },
    recommendedWindow,
    timeline: {
      arrivalAt: job.arrivalAt,
      deadlineAt: job.deadlineAt,
      forecastStartUtc: iso(start),
      forecastCoverageEndUtc: iso(coverageEnd),
      windowsEvaluatedUntilUtc: iso(Math.min(deadline, coverageEnd)),
      deadlineBeyondForecast: deadline > coverageEnd,
      timezone: forecast.timezone,
      note: 'All times are UTC. Windows after the end of the forecast are not evaluated.',
    },
    provenance: {
      provider: snapshot.provider,
      dataClass: snapshot.dataClass,
      zone: snapshot.zone,
      issuedAt: snapshot.issuedAt,
      fetchedAt: snapshot.fetchedAt,
      horizonHours: snapshot.horizonHours,
      granularity: snapshot.granularity,
      emissionFactorType: snapshot.emissionFactorType,
      endpoint: snapshot.endpoint,
      rawSha256: snapshot.rawSha256,
      uncertaintySource: forecast.uncertaintySource,
    },
    energyAssumption: energy,
    emissionsLabel: 'Estimated emissions (assumed energy) = forecast intensity x assumed energy. Not measured or realized.',
    timeWeightedForecast: {
      recommendedIntensity: rec.forecastIntensityTimeWeighted,
      immediateIntensity: immediate.forecastIntensityTimeWeighted,
      savingsVsImmediatePct:
        rec.forecastIntensityTimeWeighted !== null && immediate.forecastIntensityTimeWeighted
          ? Math.round(((immediate.forecastIntensityTimeWeighted - rec.forecastIntensityTimeWeighted) / immediate.forecastIntensityTimeWeighted) * 10000) / 100
          : null,
      basis: 'Forecast intensity weighted by the minutes each forecast interval overlaps the window. Predicted, not observed.',
    },
  };

  const decision = store.addDecision({
    jobId: job.id,
    snapshotId: snapshot.id,
    engineVersion: ENGINE_VERSION,
    status: 'RECOMMENDED',
    dataMode: input.mode,
    dataClass: snapshot.dataClass,
    riskModel: result.riskModel,
    recommendedWindow,
    immediateWindow,
    energyAssumption: energy,
    result: response,
  });
  return { ...response, decisionId: decision.id, snapshotId: snapshot.id };
}

/**
 * Collects provider observations for the job's scheduled window (and the Immediate
 * window, for an observed comparison). Every attempt is stored. Nothing is invented: if the
 * window has not finished, is older than the 24 h history window, or the provider fails,
 * the status says so and no values are produced.
 */
export async function collectObservations(
  jobId: string,
  deps: { now?: () => number; store?: SchedulingStore; client?: ElectricityMapsClient } = {}
): Promise<StoredObservationSet> {
  const now = (deps.now ?? Date.now)();
  const store = deps.store ?? schedulingStore();
  const client = deps.client ?? electricityMaps;
  const decision = store.latestDecisionForJob(jobId);
  if (!decision) throw new WorkflowError(404, `No scheduling decision found for job ${jobId}.`);
  if (decision.status !== 'RECOMMENDED' || !decision.recommendedWindow) {
    throw new WorkflowError(409, 'The job has no recommended execution window (its decision was infeasible).');
  }
  const snapshot = store.getSnapshot(decision.snapshotId as string)!;
  const window = decision.recommendedWindow;
  const intervals = hourlyIntervals(window.startUtc, window.endUtc);
  const base = {
    jobId,
    decisionId: decision.id,
    window,
    intervals,
    collectedAt: new Date(now).toISOString(),
    observations: [],
    missingIntervals: [] as string[],
    provider: null,
    endpoint: null,
    rawSha256: null,
  };

  if (decision.dataClass === 'synthetic') {
    return store.addObservationSet({
      ...base,
      status: 'NOT_APPLICABLE_SYNTHETIC',
      statusDetail: 'This decision used the synthetic demo trace, so there is no real forecast to compare with observations.',
    });
  }
  const windowEnd = Date.parse(window.endUtc);
  if (now < windowEnd) {
    return store.addObservationSet({
      ...base,
      status: 'PENDING_WINDOW_NOT_FINISHED',
      statusDetail: `The scheduled window ends at ${window.endUtc}. Observations can be collected after that, and must be collected within ${HISTORY_WINDOW_HOURS} h of the window start.`,
    });
  }
  if (Date.parse(intervals[0]) < now - HISTORY_WINDOW_HOURS * HOUR) {
    return store.addObservationSet({
      ...base,
      status: 'UNAVAILABLE_WINDOW_MISSED',
      statusDetail: `The window started more than ${HISTORY_WINDOW_HOURS} h ago. The current Electricity Maps plan only provides the last ${HISTORY_WINDOW_HOURS} h of history (past-range is not included), so these observations can no longer be retrieved.`,
    });
  }

  let history;
  try {
    history = await client.getHistory(snapshot.zone, { granularity: 'hourly', emissionFactorType: snapshot.emissionFactorType });
  } catch (err: any) {
    return store.addObservationSet({
      ...base,
      status: 'UNAVAILABLE_PROVIDER_ERROR',
      statusDetail: `Electricity Maps history could not be retrieved: ${err?.message || 'unknown error'}`,
      errorCode: err?.code,
    });
  }
  const pick = (ivs: string[]) => {
    const wanted = new Set(ivs);
    const observations = history.observations.filter((o) => wanted.has(o.datetime));
    const have = new Set(observations.map((o) => o.datetime));
    return { observations, missingIntervals: ivs.filter((t) => !have.has(t)) };
  };
  const main = pick(intervals);
  const immediateIntervals = decision.immediateWindow ? hourlyIntervals(decision.immediateWindow.startUtc, decision.immediateWindow.endUtc) : [];
  const imm = pick(immediateIntervals);
  return store.addObservationSet({
    ...base,
    observations: main.observations,
    missingIntervals: main.missingIntervals,
    immediate: decision.immediateWindow
      ? { window: decision.immediateWindow, intervals: immediateIntervals, observations: imm.observations, missingIntervals: imm.missingIntervals }
      : undefined,
    status: main.missingIntervals.length === 0 ? 'COMPLETE' : 'PARTIAL',
    statusDetail:
      main.missingIntervals.length === 0
        ? 'Observations were found for every interval of the scheduled window.'
        : `No observation was available for ${main.missingIntervals.length} of ${intervals.length} interval(s); they are reported as missing, not estimated by CarbonRoute.`,
    provider: 'electricitymaps',
    endpoint: history.endpoint,
    rawSha256: history.rawSha256,
  });
}

/** Interval length in minutes for a stored granularity. */
const GRANULARITY_MIN: Record<string, number> = { '5_minutes': 5, '15_minutes': 15, hourly: 60 };

/**
 * Evaluation of the latest observation collection against the stored forecast:
 *  - per-interval forecast error (matched intervals only, measured and estimates separately);
 *  - time-weighted forecast and observed intensity for the recommended window;
 *  - emissions: realized only with recorded energy, otherwise an estimate labelled as such;
 *  - comparison with the Immediate window on time-weighted intensity, only when both windows
 *    are fully observed with the same emission-factor type.
 * Stored decisions and records are only read, never changed.
 */
export function evaluateJob(jobId: string, store: SchedulingStore = schedulingStore()) {
  const decision = store.latestDecisionForJob(jobId);
  if (!decision) throw new WorkflowError(404, `No scheduling decision found for job ${jobId}.`);
  const sets = store.observationSetsForJob(jobId);
  const latest = sets[sets.length - 1] ?? null;
  const snapshot = decision.snapshotId ? store.getSnapshot(decision.snapshotId) : undefined;
  const execution = store.latestExecutionForJob(jobId);
  const empty = { decision, snapshot: snapshot ?? null, observationSet: latest, evaluation: null, intensity: null, emissions: null, windowComparison: null };
  if (!latest || !snapshot || !decision.recommendedWindow || !['COMPLETE', 'PARTIAL'].includes(latest.status)) return empty;

  const forecastSpec = {
    points: snapshot.points,
    granularityMinutes: GRANULARITY_MIN[snapshot.granularity] ?? 60,
    emissionFactorType: snapshot.emissionFactorType,
  };
  const evaluation = evaluateForecast(latest.intervals, snapshot.points, latest.observations);
  const intensity = windowIntensity(decision.recommendedWindow, forecastSpec, latest.observations);
  const emissions = assessEmissions(intensity.observed, decision.energyAssumption, execution?.measuredEnergyKwh);

  let windowComparison: any = null;
  if (latest.immediate && decision.immediateWindow) {
    const imm = windowIntensity(decision.immediateWindow, forecastSpec, latest.immediate.observations);
    const immEmissions = assessEmissions(imm.observed, decision.energyAssumption, null);
    const both = intensity.observed.value !== null && imm.observed.value !== null;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    windowComparison = {
      available: both,
      emissionFactorType: snapshot.emissionFactorType,
      recommended: { window: intensity.window, forecastIntensity: intensity.forecast.value, observedIntensity: intensity.observed.value, observedQuality: intensity.observed.quality, segments: intensity.observed.segments },
      immediate: { window: imm.window, forecastIntensity: imm.forecast.value, observedIntensity: imm.observed.value, observedQuality: imm.observed.quality, segments: imm.observed.segments, missing: imm.observed.missing },
      forecastDifference: intensity.forecast.value !== null && imm.forecast.value !== null ? r2(imm.forecast.value - intensity.forecast.value) : null,
      observedDifference: both ? r2((imm.observed.value as number) - (intensity.observed.value as number)) : null,
      observedDifferencePct: both ? r2((((imm.observed.value as number) - (intensity.observed.value as number)) / (imm.observed.value as number)) * 100) : null,
      estimatedEmissions: {
        label: emissions.estimated.label,
        recommendedGrams: emissions.estimated.grams,
        immediateGrams: immEmissions.estimated.grams,
        basis: 'Both use the same ASSUMED energy; not measured or realized emissions.',
      },
      realizedEmissions: emissions.realized.available ? 'see emissions.realized' : 'unavailable: no recorded energy for either window',
      unit: 'gCO2eq/kWh',
      basis: both
        ? 'Time-weighted intensities (each interval weighted by the minutes it overlaps the window). Positive differences mean the Immediate window had higher intensity. This is a counterfactual comparison: the job ran only once.'
        : `Not available: ${intensity.observed.value === null ? 'the recommended window' : 'the Immediate window'} is not fully observed.`,
    };
  }
  return { decision, snapshot, observationSet: latest, evaluation, intensity, emissions, windowComparison };
}

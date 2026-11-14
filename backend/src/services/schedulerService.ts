/**
 * Scheduling engine (P1: audited and corrected).
 *
 * Evaluates the single-job policies on ONE forecast, over hourly start slots t (hours after
 * the forecast start) for a job of d whole hours:
 *
 *   window(t)    = slots t .. t+d-1, average forecast intensity I(t) (exact, not rounded)
 *   candidates   = t in [arrival, min(H, D) - d]   (H = forecast length, D = deadline slot)
 *   deadline risk P(miss | t) from declared runtime variability only (uncertaintyService)
 *   feasible(t)  = window has no missing values AND P(miss | t) <= tau
 *
 * Policies (all on the same candidates):
 *   immediate             t = arrival
 *   edf                   identical to immediate for a single job (labelled as such)
 *   deterministic_carbon  argmin I(t) over gap-free candidates, ignoring risk (Greedy)
 *   carbon_aware_baseline earliest gap-free candidate within a static safety buffer whose
 *                         I(t) <= 25th percentile of those candidates; else their minimum
 *   carbonroute_uncertainty argmin I(t) over FEASIBLE candidates (ties: earliest).
 *                         If none is feasible the result is INFEASIBLE_RISK: there is no
 *                         "safety fallback" that recommends a window over the tolerance.
 *
 * Not in the engine:
 *   - cost_aware: no electricity-price provider is configured, so it is reported UNAVAILABLE.
 *   - oracle: hindsight evaluation on REALIZED data only (src/evaluation/oracle.ts); it is
 *     never used to make a decision.
 *
 * Nothing is filled in: a missing forecast value makes every window containing it
 * REJECTED_DATA_GAP, and windows never wrap around the end of the forecast.
 */
import { CarbonForecastData, HourlyCarbonPoint } from './carbonService';
import { UncertaintyService, MAX_RUNTIME_CV } from './uncertaintyService';
import { energyAssumption } from './energyModel';
import { explainDecision, DecisionExplanation } from './explain';

export interface WorkloadJob {
  id: string;
  name: string;
  commandOrImage: string;
  isContainerImage: boolean;
  durationHours: number;
  /** Deadline in hours after the forecast start; may be fractional (exact instant). */
  deadlineHours: number;
  arrivalHour: number;
  /**
   * P8: the job arrives this many hours after the start of slot `arrivalHour` (0 <= x < 1). A job
   * starting in the arrival slot starts at the arrival instant, not at the slot start, so its
   * deadline risk is computed from that instant.
   */
  arrivalOffsetHours?: number;
  cpu: number;
  memoryMb: number;
  region: string;
  riskTolerance: number; // tau in (0, 1), e.g. 0.05 (5%)
  /** Declared runtime coefficient of variation (0 = deterministic runtime). */
  runtimeCv?: number;
  status?: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  /** User who registered the job (M1.2). */
  ownerId?: string;
}

export interface PolicyEvaluationResult {
  policyId: string;
  policyName: string;
  category: 'Baseline' | 'Deterministic' | 'Uncertainty-Aware';
  selectedStartHour: number;
  selectedEndHour: number;
  selectedWindow: string;
  predictedCarbon: number; // Window average carbon intensity in gCO2eq/kWh (legacy alias)
  predictedCarbonIntensity: number; // Window average forecast intensity, gCO2eq/kWh (2 dp)
  estimatedWorkloadEmissionsGrams: number; // forecast intensity x ASSUMED energy, gCO2eq
  carbonIntensityUnit: string;
  workloadEmissionsUnit: string;
  estimatedDeadlineRisk: number; // P(miss) for this window
  waitingTimeHours: number;
  isFeasible: boolean;
  schedulerOverheadMs: number;
  rationale: string;
  /** Set when this policy necessarily picks the same window as another (e.g. EDF = Immediate). */
  equivalentTo?: string;
}

export interface UnavailablePolicy {
  policyId: string;
  policyName: string;
  reason: string;
}

export type WindowClassification =
  | 'RECOMMENDED'
  | 'FEASIBLE'
  | 'REJECTED_HIGH_RISK'
  | 'REJECTED_DEADLINE_BREACH'
  | 'REJECTED_DATA_GAP';

export interface CandidateWindowEvaluation {
  slotIndex: number;
  startHour: number;
  endHour: number;
  windowLabel: string;
  predictedCarbonIntensity: number; // gCO2eq/kWh (2 dp); NaN only for REJECTED_DATA_GAP
  predictedCarbonImpactGrams: number; // forecast intensity x assumed energy
  /** Average forecast (carbon) standard deviation when the provider gives one; null otherwise. Not used for deadline risk. */
  stdDev: number | null;
  uncertaintyRange: string;
  deadlineRisk: number;
  deadlineRiskPct: string;
  slackHours: number;
  waitingTimeHours: number;
  isFeasible: boolean;
  meetsDeadline: boolean;
  classification: WindowClassification;
  classificationLabel: string;
  reason: string;
}

export interface ResearchInsightLowestVsSafest {
  lowestCarbonWindow: CandidateWindowEvaluation;
  recommendedWindow: CandidateWindowEvaluation;
  isLowestCarbonSafe: boolean;
  carbonInsurancePenaltyGramsPerKwh: number;
  explanation: string;
}

export type RiskModel = 'deterministic' | 'declared-runtime-cv';

interface EngineCommon {
  job: WorkloadJob;
  carbonSource: string;
  dataMode: 'live' | 'demo';
  region: string;
  /** How deadline risk was computed (see uncertaintyService). */
  riskModel: RiskModel;
  runtimeCv: number;
  candidateWindows: CandidateWindowEvaluation[];
  evaluatedPolicies: PolicyEvaluationResult[];
  unavailablePolicies: UnavailablePolicy[];
  /** Structured explanation (P4): objective, constraints, binding constraint, policy relations. */
  explanation?: DecisionExplanation;
}

export interface SchedulingDecisionResponse extends EngineCommon {
  status: 'RECOMMENDED';
  recommendedDecision: PolicyEvaluationResult;
  comparisonSummary: {
    carbonSavingsVsImmediatePct: number;
    delayPenaltyHours: number;
    riskDifferenceVsDeterministic: number;
  };
  researchInsight?: ResearchInsightLowestVsSafest;
}

export interface SchedulingInfeasibleResponse extends EngineCommon {
  status: 'INFEASIBLE_RISK' | 'NO_FEASIBLE_WINDOW';
  reason: string;
  recommendedDecision: null;
}

export type EngineOutcome = SchedulingDecisionResponse | SchedulingInfeasibleResponse;

export class EngineInfeasibleError extends Error {
  constructor(public readonly outcome: SchedulingInfeasibleResponse) {
    super(outcome.reason);
    this.name = 'EngineInfeasibleError';
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const label = (s: number, e: number) => `T+${s}:00 → T+${e}:00`;

/** Engine options. A plain number (the removed uncertaintyMultiplier) is ignored. */
export interface EngineOptions {
  runtimeCv?: number;
}

export class SchedulerService {
  /** Evaluates every policy; returns an explicit infeasible outcome instead of a fallback. */
  public static evaluatePolicies(
    job: WorkloadJob,
    forecast: CarbonForecastData | HourlyCarbonPoint[],
    options: EngineOptions | number = {}
  ): EngineOutcome {
    const out = SchedulerService.evaluateCore(job, forecast, options);
    out.explanation = explainDecision({
      status: out.status,
      reason: out.status === 'RECOMMENDED' ? undefined : out.reason,
      riskModel: out.riskModel,
      runtimeCv: out.runtimeCv,
      riskTolerance: Number(job.riskTolerance),
      deadlineHours: Number(job.deadlineHours),
      durationHours: Number(job.durationHours),
      candidateWindows: out.candidateWindows,
      evaluatedPolicies: out.evaluatedPolicies,
      unavailablePolicies: out.unavailablePolicies,
      recommendedDecision: out.recommendedDecision,
    });
    return out;
  }

  private static evaluateCore(
    job: WorkloadJob,
    forecast: CarbonForecastData | HourlyCarbonPoint[],
    options: EngineOptions | number = {}
  ): EngineOutcome {
    const started = performance.now();
    const opts: EngineOptions = typeof options === 'number' ? {} : options || {};
    const points: HourlyCarbonPoint[] = Array.isArray(forecast) ? forecast : forecast.hourlyProfile || [];
    const carbonSource = Array.isArray(forecast) ? 'Prepared Carbon Trace' : forecast.source || 'Prepared Carbon Trace';
    const dataMode: 'live' | 'demo' = Array.isArray(forecast) ? 'demo' : forecast.dataMode || 'demo';
    const region = Array.isArray(forecast) ? job.region : forecast.region || job.region;

    const dur = Number(job.durationHours);
    if (!Number.isInteger(dur) || dur < 1) throw new Error('durationHours must be a positive whole number of hours.');
    const arrival = Number(job.arrivalHour) || 0;
    if (!Number.isInteger(arrival) || arrival < 0) throw new Error('arrivalHour must be a non-negative whole number.');
    const deadline = Number(job.deadlineHours);
    if (!Number.isFinite(deadline)) throw new Error('deadlineHours must be a number.');
    const arrivalOffset = Number(job.arrivalOffsetHours ?? 0);
    if (!(arrivalOffset >= 0 && arrivalOffset < 1)) throw new Error('arrivalOffsetHours must be in [0, 1).');
    /** Actual start instant (hours after the forecast start) of a window that starts in slot t. */
    const startOf = (t: number) => (t === arrival ? arrival + arrivalOffset : t);
    const tau = Number(job.riskTolerance);
    if (!(tau > 0 && tau < 1)) throw new Error('riskTolerance must be between 0 and 1 (exclusive).');
    const cvInput = opts.runtimeCv ?? job.runtimeCv ?? 0;
    if (!(Number.isFinite(cvInput) && cvInput >= 0 && cvInput <= MAX_RUNTIME_CV)) {
      throw new Error(`runtimeCv must be between 0 and ${MAX_RUNTIME_CV}.`);
    }
    const runtimeCv = Number(cvInput);
    const riskModel: RiskModel = runtimeCv > 0 ? 'declared-runtime-cv' : 'deterministic';
    const energyKwh = energyAssumption(job.cpu, dur).energyKwh;

    const value = (i: number): number | null => {
      const p = points[i];
      const v = p ? (p.predictedCarbon ?? p.carbonIntensity) : undefined;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const sigmaAt = (i: number): number | null => {
      const p = points[i];
      const s = p ? (p.stdDev ?? p.uncertaintyStdDev) : null;
      return typeof s === 'number' && Number.isFinite(s) ? s : null;
    };
    const windowStats = (t: number): { avg: number | null; sigma: number | null } => {
      let sum = 0;
      let sumSigma = 0;
      let sigmaComplete = true;
      for (let h = t; h < t + dur; h++) {
        const v = value(h);
        if (v === null) return { avg: null, sigma: null };
        sum += v;
        const s = sigmaAt(h);
        if (s === null) sigmaComplete = false;
        else sumSigma += s;
      }
      return { avg: sum / dur, sigma: sigmaComplete ? sumSigma / dur : null };
    };

    // ---- Candidate windows (no wrap-around, no fill-in) ----
    const lastStart = Math.min(points.length, Math.floor(deadline)) - dur;
    const candidates: (CandidateWindowEvaluation & { exactAvg: number | null })[] = [];
    for (let t = arrival; t <= lastStart; t++) {
      const { avg, sigma } = windowStats(t);
      const end = startOf(t) + dur;
      const risk = UncertaintyService.deadlineRisk(startOf(t), dur, deadline, runtimeCv).violationRisk;
      const slack = deadline - end;
      let classification: WindowClassification;
      let reason: string;
      if (avg === null) {
        classification = 'REJECTED_DATA_GAP';
        reason = 'The forecast has a missing value in this window; nothing is filled in, so the window is not evaluated.';
      } else if (risk > tau) {
        classification = 'REJECTED_HIGH_RISK';
        reason = `Deadline-miss risk ${pct(risk)} exceeds the ${pct(tau)} tolerance.`;
      } else {
        classification = 'FEASIBLE';
        reason = `Feasible: ${round2(avg)} gCO2eq/kWh forecast, ${pct(risk)} deadline-miss risk (tolerance ${pct(tau)}).`;
      }
      candidates.push({
        slotIndex: t,
        startHour: t,
        endHour: end,
        windowLabel: label(t, end),
        predictedCarbonIntensity: avg === null ? NaN : round2(avg),
        predictedCarbonImpactGrams: avg === null ? NaN : round1(avg * energyKwh),
        stdDev: sigma === null ? null : round2(sigma),
        uncertaintyRange:
          avg === null
            ? 'missing forecast data'
            : sigma === null
              ? `${round2(avg)} gCO2eq/kWh (no forecast uncertainty available)`
              : `${round2(avg)} ± ${round2(sigma)} gCO2eq/kWh (synthetic σ)`,
        deadlineRisk: risk,
        deadlineRiskPct: pct(risk),
        slackHours: slack,
        waitingTimeHours: t - arrival,
        isFeasible: classification === 'FEASIBLE',
        meetsDeadline: end <= deadline,
        classification,
        classificationLabel: classification === 'FEASIBLE' ? 'FEASIBLE' : classification.replace(/_/g, ' '),
        reason,
        exactAvg: avg,
      });
    }

    const strip = (c: (typeof candidates)[number]): CandidateWindowEvaluation => {
      const { exactAvg: _ignored, ...rest } = c;
      return rest;
    };
    const unavailablePolicies: UnavailablePolicy[] = [
      {
        policyId: 'cost_aware',
        policyName: 'Cost-Aware',
        reason: 'No electricity-price data provider is configured, so cost cannot be evaluated (dependency D7).',
      },
      {
        policyId: 'oracle',
        policyName: 'Oracle (hindsight)',
        reason: 'Offline evaluation only: it needs realized observations for every candidate window and is never used to schedule. See GET /api/jobs/:id/oracle.',
      },
    ];
    const common = (): EngineCommon => ({
      job,
      carbonSource,
      dataMode,
      region,
      riskModel,
      runtimeCv,
      candidateWindows: candidates.map(strip),
      evaluatedPolicies: [],
      unavailablePolicies,
    });

    const gapFree = candidates.filter((c) => c.exactAvg !== null);
    if (gapFree.length === 0) {
      const reason =
        candidates.length === 0
          ? `No start slot exists: a ${dur} h job arriving at slot ${arrival} cannot finish by T+${Number(deadline.toFixed(2))} h within the ${points.length}-hour forecast.`
          : 'Every candidate window contains missing forecast data; nothing is filled in.';
      return { ...common(), status: 'NO_FEASIBLE_WINDOW', reason, recommendedDecision: null };
    }

    const byLowest = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
      (a.exactAvg as number) - (b.exactAvg as number) || a.startHour - b.startHour;
    const policyFrom = (
      c: (typeof candidates)[number],
      meta: Pick<PolicyEvaluationResult, 'policyId' | 'policyName' | 'category' | 'rationale'> & { equivalentTo?: string }
    ): PolicyEvaluationResult => ({
      ...meta,
      selectedStartHour: c.startHour,
      selectedEndHour: c.endHour,
      selectedWindow: `T+${c.startHour}:00 to T+${c.endHour}:00`,
      predictedCarbon: c.predictedCarbonIntensity,
      predictedCarbonIntensity: c.predictedCarbonIntensity,
      estimatedWorkloadEmissionsGrams: c.predictedCarbonImpactGrams,
      carbonIntensityUnit: 'gCO2eq/kWh',
      workloadEmissionsUnit: 'gCO2eq',
      estimatedDeadlineRisk: c.deadlineRisk,
      waitingTimeHours: c.waitingTimeHours,
      isFeasible: c.isFeasible,
      schedulerOverheadMs: 0,
    });

    const policies: PolicyEvaluationResult[] = [];
    const first = candidates[0]; // slot = arrival
    if (first.exactAvg === null) {
      unavailablePolicies.push(
        { policyId: 'immediate', policyName: 'Immediate Execution', reason: 'The window starting at arrival has missing forecast data.' },
        { policyId: 'edf', policyName: 'Earliest Deadline First (EDF)', reason: 'Same window as Immediate, which has missing forecast data.' }
      );
    } else {
      policies.push(
        policyFrom(first, {
          policyId: 'immediate',
          policyName: 'Immediate Execution',
          category: 'Baseline',
          rationale: 'Starts at arrival without waiting. Reference baseline.',
        }),
        policyFrom(first, {
          policyId: 'edf',
          policyName: 'Earliest Deadline First (EDF)',
          category: 'Baseline',
          equivalentTo: 'immediate',
          rationale:
            'With a single job there is nothing to order, so EDF starts at arrival exactly like Immediate. EDF only differs when several jobs compete (queue mode, not implemented).',
        })
      );
    }

    const greedy = [...gapFree].sort(byLowest)[0];
    policies.push(
      policyFrom(greedy, {
        policyId: 'deterministic_carbon',
        policyName: 'Deterministic Carbon-Aware (Greedy)',
        category: 'Deterministic',
        rationale: `Picks the lowest forecast window before the deadline (${greedy.windowLabel}, ${greedy.predictedCarbonIntensity} gCO2eq/kWh) and ignores deadline risk.`,
      })
    );

    // CarbonAware baseline: static buffer, threshold over the windows it may choose from.
    const plannedSlack = Math.floor(deadline) - (arrival + dur);
    const staticBuffer = Math.max(1, Math.min(3, Math.round(plannedSlack * 0.25)));
    const bufferedLast = Math.max(arrival, Math.floor(deadline) - dur - staticBuffer);
    const eligible = gapFree.filter((c) => c.startHour <= bufferedLast);
    const pool = eligible.length > 0 ? eligible : [gapFree[0]];
    const sortedAvgs = pool.map((c) => c.exactAvg as number).sort((a, b) => a - b);
    const threshold = sortedAvgs[Math.floor(sortedAvgs.length * 0.25)];
    const baselinePick = pool.find((c) => (c.exactAvg as number) <= threshold) ?? [...pool].sort(byLowest)[0];
    policies.push(
      policyFrom(baselinePick, {
        policyId: 'carbon_aware_baseline',
        policyName: 'CarbonAware Baseline',
        category: 'Baseline',
        rationale: `Heuristic: earliest window starting by T+${bufferedLast} (a ${staticBuffer} h safety buffer before the deadline) whose forecast is at or below the 25th percentile of those windows (${round2(threshold)} gCO2eq/kWh). Chose ${baselinePick.windowLabel}.`,
      })
    );

    const feasible = gapFree.filter((c) => c.isFeasible);
    const overheadMs = Number((performance.now() - started).toFixed(2));
    if (feasible.length === 0) {
      const minRisk = Math.min(...gapFree.map((c) => c.deadlineRisk));
      return {
        ...common(),
        evaluatedPolicies: policies.map((p) => ({ ...p, schedulerOverheadMs: overheadMs })),
        status: 'INFEASIBLE_RISK',
        reason: `No window meets the ${pct(tau)} deadline-risk tolerance (lowest risk among windows: ${pct(minRisk)}). No recommendation is made; relax the deadline or the tolerance, or declare a smaller runtime variability if it is justified.`,
        recommendedDecision: null,
      };
    }

    const best = [...feasible].sort(byLowest)[0];
    best.classification = 'RECOMMENDED';
    best.classificationLabel = 'RECOMMENDED';
    best.reason = 'Lowest forecast intensity among windows that meet the deadline and the risk tolerance.';
    const carbonRoute = policyFrom(best, {
      policyId: 'carbonroute_uncertainty',
      policyName: 'CarbonRoute (risk-constrained)',
      category: 'Uncertainty-Aware',
      rationale: `Lowest forecast window with deadline-miss risk at or below ${pct(tau)} (${riskModel === 'deterministic' ? 'deterministic runtime' : `declared runtime CV ${runtimeCv}`}): ${best.windowLabel}, ${best.predictedCarbonIntensity} gCO2eq/kWh, risk ${best.deadlineRiskPct}.`,
    });
    policies.push(carbonRoute);
    const evaluatedPolicies = policies.map((p) => ({ ...p, schedulerOverheadMs: overheadMs }));
    const recommendedDecision = evaluatedPolicies[evaluatedPolicies.length - 1];

    const lowest = [...gapFree].sort(byLowest)[0];
    const isLowestCarbonSafe = lowest.deadlineRisk <= tau;
    const penalty = round2(Math.max(0, (best.exactAvg as number) - (lowest.exactAvg as number)));
    const researchInsight: ResearchInsightLowestVsSafest = {
      lowestCarbonWindow: strip(lowest),
      recommendedWindow: strip(best),
      isLowestCarbonSafe,
      carbonInsurancePenaltyGramsPerKwh: penalty,
      explanation: isLowestCarbonSafe
        ? `The lowest forecast window (${lowest.windowLabel}, ${lowest.predictedCarbonIntensity} gCO2eq/kWh) is within the ${pct(tau)} risk tolerance, so it is recommended.`
        : `The lowest forecast window (${lowest.windowLabel}, ${lowest.predictedCarbonIntensity} gCO2eq/kWh) leaves ${lowest.slackHours} h of slack; with the declared runtime variability (CV ${runtimeCv}) its deadline-miss risk is ${lowest.deadlineRiskPct}, above the ${pct(tau)} tolerance. The recommendation (${best.windowLabel}) costs ${penalty} gCO2eq/kWh more in forecast intensity in exchange for meeting the tolerance.`,
    };

    const immediate = evaluatedPolicies.find((p) => p.policyId === 'immediate');
    const greedyPolicy = evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon')!;
    return {
      ...common(),
      evaluatedPolicies,
      status: 'RECOMMENDED',
      recommendedDecision,
      comparisonSummary: {
        carbonSavingsVsImmediatePct:
          immediate && immediate.predictedCarbonIntensity > 0
            ? round1(((immediate.predictedCarbonIntensity - recommendedDecision.predictedCarbonIntensity) / immediate.predictedCarbonIntensity) * 100)
            : 0,
        delayPenaltyHours: recommendedDecision.waitingTimeHours,
        riskDifferenceVsDeterministic: round1((greedyPolicy.estimatedDeadlineRisk - recommendedDecision.estimatedDeadlineRisk) * 100),
      },
      researchInsight,
    };
  }

  /**
   * Original API: returns a recommendation or throws EngineInfeasibleError (no fallback).
   * The third argument used to be an "uncertainty multiplier" for the removed risk model; a
   * number is ignored. Pass { runtimeCv } for declared runtime variability.
   */
  public static evaluateAllPolicies(
    job: WorkloadJob,
    forecast: CarbonForecastData | HourlyCarbonPoint[],
    options: EngineOptions | number = {}
  ): SchedulingDecisionResponse {
    const out = SchedulerService.evaluatePolicies(job, forecast, options);
    if (out.status !== 'RECOMMENDED') throw new EngineInfeasibleError(out);
    return out;
  }
}

export function evaluateAllPolicies(
  job: WorkloadJob,
  forecast: CarbonForecastData | HourlyCarbonPoint[],
  options?: EngineOptions | number
): SchedulingDecisionResponse {
  return SchedulerService.evaluateAllPolicies(job, forecast, options);
}

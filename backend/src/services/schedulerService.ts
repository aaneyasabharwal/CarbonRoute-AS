import { CarbonForecastData, HourlyCarbonPoint } from './carbonService';
import { UncertaintyService } from './uncertaintyService';

export interface WorkloadJob {
  id: string;
  name: string;
  commandOrImage: string;
  isContainerImage: boolean;
  durationHours: number;
  deadlineHours: number;
  arrivalHour: number;
  cpu: number;
  memoryMb: number;
  region: string;
  riskTolerance: number; // tau in (0, 1), e.g. 0.05 (5%)
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
  predictedCarbonIntensity: number; // Window average carbon intensity in gCO2eq/kWh
  estimatedWorkloadEmissionsGrams: number; // Estimated workload emissions in gCO2eq
  carbonIntensityUnit: string; // 'gCO2eq/kWh'
  workloadEmissionsUnit: string; // 'gCO2eq'
  estimatedDeadlineRisk: number; // e.g. 0.04 (4%)
  waitingTimeHours: number;
  isFeasible: boolean;
  schedulerOverheadMs: number;
  rationale: string;
}

export interface CandidateWindowEvaluation {
  slotIndex: number;
  startHour: number;
  endHour: number;
  windowLabel: string;
  predictedCarbonIntensity: number; // gCO2eq/kWh
  predictedCarbonImpactGrams: number; // estimated total grams CO2
  stdDev: number | null; // forecast uncertainty sigma; null when the data provides none
  uncertaintyRange: string;
  deadlineRisk: number; // decimal probability
  deadlineRiskPct: string; // e.g. "4.0%"
  slackHours: number;
  waitingTimeHours: number;
  isFeasible: boolean;
  meetsDeadline: boolean;
  classification:
    | 'RECOMMENDED'
    | 'FEASIBLE'
    | 'REJECTED_HIGH_RISK'
    | 'REJECTED_DEADLINE_BREACH';
  classificationLabel: string; // "RECOMMENDED" | "FEASIBLE BUT NOT OPTIMAL" | "REJECTED — HIGH DEADLINE RISK" | "REJECTED — MISSES DEADLINE"
  reason: string;
}

export interface ResearchInsightLowestVsSafest {
  lowestCarbonWindow: CandidateWindowEvaluation;
  recommendedWindow: CandidateWindowEvaluation;
  isLowestCarbonSafe: boolean;
  carbonInsurancePenaltyGramsPerKwh: number;
  explanation: string;
}

export interface SchedulingDecisionResponse {
  job: WorkloadJob;
  carbonSource: string;
  dataMode: 'live' | 'demo';
  region: string;
  /**
   * How deadline risk was computed: with the synthetic demo trace's uncertainty, or
   * deterministically (window fits before the deadline or not) when the forecast has none.
   */
  riskModel: 'synthetic-demo-uncertainty' | 'deterministic-no-uncertainty-data';
  candidateWindows: CandidateWindowEvaluation[];
  evaluatedPolicies: PolicyEvaluationResult[];
  recommendedDecision: PolicyEvaluationResult;
  comparisonSummary: {
    carbonSavingsVsImmediatePct: number;
    delayPenaltyHours: number;
    riskDifferenceVsDeterministic: number;
  };
  researchInsight?: ResearchInsightLowestVsSafest;
}

export class SchedulerService {
  /**
   * Evaluates all 5 scheduling policies simultaneously on the exact same workload
   * and underlying carbon forecast trace.
   */
  public static evaluateAllPolicies(
    job: WorkloadJob,
    forecast: CarbonForecastData | HourlyCarbonPoint[],
    uncertaintyMultiplier: number = 1.0
  ): SchedulingDecisionResponse {
    // Normalize forecast input (support either full CarbonForecastData or raw points array)
    const points: HourlyCarbonPoint[] = Array.isArray(forecast)
      ? forecast
      : forecast.hourlyProfile || [];
    const source = Array.isArray(forecast)
      ? 'Prepared Carbon Trace'
      : forecast.source || 'Prepared Carbon Trace';
    const dataMode = Array.isArray(forecast)
      ? 'demo'
      : forecast.dataMode || 'demo';
    const region = Array.isArray(forecast)
      ? job.region || 'US-CAL-CISO'
      : forecast.region || job.region || 'US-CAL-CISO';

    const horizon = points.length;
    const dur = Math.max(1, Math.round(Number(job.durationHours) || 1));
    const ddl = Math.min(horizon, Math.max(dur, Math.round(Number(job.deadlineHours) || dur + 2)));
    const arrival = Math.max(0, Math.min(ddl - dur, Math.round(Number(job.arrivalHour) || 0)));
    const tau = Math.max(0.001, Math.min(0.50, Number(job.riskTolerance) || 0.05));
    const powerKw = Math.max(0.1, Number((((job.cpu || 2) / 2) * 0.25).toFixed(3)));
    const energyKwh = Number((dur * powerKw).toFixed(3));

    /**
     * Helper: computes window average carbon intensity and average uncertainty
     * for a job running continuously from hour t to t + dur - 1.
     */
    // Forecast uncertainty is only used when every point provides it (synthetic demo traces do;
    // Electricity Maps forecasts do not). It is never filled in with an assumed value.
    const hasUncertainty = points.length > 0 && points.every((p) => typeof (p.stdDev ?? p.uncertaintyStdDev) === 'number');
    const riskModel: SchedulingDecisionResponse['riskModel'] = hasUncertainty
      ? 'synthetic-demo-uncertainty'
      : 'deterministic-no-uncertainty-data';

    const computeWindowMetrics = (startHour: number) => {
      let sumCarbon = 0;
      let sumStd = 0;
      for (let h = startHour; h < startHour + dur; h++) {
        const pt = points[h % horizon];
        sumCarbon += pt ? (pt.predictedCarbon ?? pt.carbonIntensity ?? 250) : 250;
        if (hasUncertainty) sumStd += pt ? ((pt.stdDev ?? pt.uncertaintyStdDev) as number) : 0;
      }
      const avgCarbon = Math.round(sumCarbon / dur);
      const avgStd: number | null = hasUncertainty ? Math.round(sumStd / dur) : null;
      return { avgCarbon, avgStd };
    };

    // -------------------------------------------------------------
    // POLICY 1: Immediate Execution (Naive Baseline)
    // -------------------------------------------------------------
    const startImm = performance.now();
    const immSlot = arrival;
    const { avgCarbon: immCarbon, avgStd: immStd } = computeWindowMetrics(immSlot);
    const immRisk = UncertaintyService.calculateDeadlineRisk(
      immSlot,
      dur,
      ddl,
      immStd,
      uncertaintyMultiplier
    ).violationRisk;
    const overheadImm = Number((performance.now() - startImm).toFixed(2));

    const immediatePolicy: PolicyEvaluationResult = {
      policyId: 'immediate',
      policyName: 'Immediate Execution',
      category: 'Baseline',
      selectedStartHour: immSlot,
      selectedEndHour: immSlot + dur,
      selectedWindow: `T+${immSlot}:00 to T+${immSlot + dur}:00`,
      predictedCarbon: immCarbon,
      predictedCarbonIntensity: immCarbon,
      estimatedWorkloadEmissionsGrams: Math.round(immCarbon * energyKwh),
      carbonIntensityUnit: 'gCO2eq/kWh',
      workloadEmissionsUnit: 'gCO2eq',
      estimatedDeadlineRisk: immRisk,
      waitingTimeHours: 0,
      isFeasible: immSlot + dur <= ddl && immRisk <= tau,
      schedulerOverheadMs: overheadImm,
      rationale: 'Dispatches job immediately upon arrival without intentional delay. Serves as benchmark baseline.',
    };

    // -------------------------------------------------------------
    // POLICY 2: Earliest Deadline First (EDF)
    // -------------------------------------------------------------
    const startEdf = performance.now();
    const edfSlot = arrival;
    const { avgCarbon: edfCarbon, avgStd: edfStd } = computeWindowMetrics(edfSlot);
    const edfRisk = UncertaintyService.calculateDeadlineRisk(
      edfSlot,
      dur,
      ddl,
      edfStd,
      uncertaintyMultiplier
    ).violationRisk;
    const overheadEdf = Number((performance.now() - startEdf).toFixed(2));

    const edfPolicy: PolicyEvaluationResult = {
      policyId: 'edf',
      policyName: 'Earliest Deadline First (EDF)',
      category: 'Baseline',
      selectedStartHour: edfSlot,
      selectedEndHour: edfSlot + dur,
      selectedWindow: `T+${edfSlot}:00 to T+${edfSlot + dur}:00`,
      predictedCarbon: edfCarbon,
      predictedCarbonIntensity: edfCarbon,
      estimatedWorkloadEmissionsGrams: Math.round(edfCarbon * energyKwh),
      carbonIntensityUnit: 'gCO2eq/kWh',
      workloadEmissionsUnit: 'gCO2eq',
      estimatedDeadlineRisk: edfRisk,
      waitingTimeHours: 0,
      isFeasible: edfSlot + dur <= ddl && edfRisk <= tau,
      schedulerOverheadMs: overheadEdf,
      rationale: 'Prioritizes deadline safety; executes at earliest feasible arrival to maximize remaining slack buffer.',
    };

    // -------------------------------------------------------------
    // POLICY 3: Deterministic Carbon-Aware (Greedy Minimum)
    // -------------------------------------------------------------
    const startDet = performance.now();
    let bestDetSlot = arrival;
    let minDetCarbon = Infinity;

    for (let t = arrival; t <= ddl - dur; t++) {
      const { avgCarbon } = computeWindowMetrics(t);
      if (avgCarbon < minDetCarbon) {
        minDetCarbon = avgCarbon;
        bestDetSlot = t;
      }
    }
    const { avgStd: detStd } = computeWindowMetrics(bestDetSlot);
    const detRisk = UncertaintyService.calculateDeadlineRisk(
      bestDetSlot,
      dur,
      ddl,
      detStd,
      uncertaintyMultiplier
    ).violationRisk;
    const overheadDet = Number((performance.now() - startDet).toFixed(2));
    const detCarbonVal = minDetCarbon === Infinity ? immCarbon : minDetCarbon;

    const detPolicy: PolicyEvaluationResult = {
      policyId: 'deterministic_carbon',
      policyName: 'Deterministic Carbon-Aware',
      category: 'Deterministic',
      selectedStartHour: bestDetSlot,
      selectedEndHour: bestDetSlot + dur,
      selectedWindow: `T+${bestDetSlot}:00 to T+${bestDetSlot + dur}:00`,
      predictedCarbon: detCarbonVal,
      predictedCarbonIntensity: detCarbonVal,
      estimatedWorkloadEmissionsGrams: Math.round(detCarbonVal * energyKwh),
      carbonIntensityUnit: 'gCO2eq/kWh',
      workloadEmissionsUnit: 'gCO2eq',
      estimatedDeadlineRisk: detRisk,
      waitingTimeHours: bestDetSlot - arrival,
      isFeasible: bestDetSlot + dur <= ddl && detRisk <= tau,
      schedulerOverheadMs: overheadDet,
      rationale: `Greedily selects the lowest predicted carbon window (T+${bestDetSlot}) without uncertainty or risk calibration.`,
    };

    // -------------------------------------------------------------
    // POLICY 4: CarbonAware Baseline (Clean Threshold & Static Safety Margin)
    // -------------------------------------------------------------
    const startBase = performance.now();
    // Conventional heuristic: reserves a static buffer (e.g. 2 hours or 25% of slack) before deadline
    const staticBuffer = Math.max(1, Math.min(3, Math.round((ddl - (arrival + dur)) * 0.25)));
    const maxBaseSlot = Math.max(arrival, ddl - dur - staticBuffer);

    // Compute clean carbon threshold (25th percentile intensity of horizon points)
    const sortedCarbons = points.map((p) => p.predictedCarbon ?? p.carbonIntensity ?? 250).sort((a, b) => a - b);
    const cleanThreshold = sortedCarbons[Math.floor(sortedCarbons.length * 0.25)] || 220;

    // Dispatches at the earliest window within safe buffer that meets the clean threshold
    let bestBaseSlot = -1;
    let minBaseCarbon = Infinity;
    for (let t = arrival; t <= maxBaseSlot; t++) {
      const { avgCarbon } = computeWindowMetrics(t);
      if (avgCarbon < minBaseCarbon) {
        minBaseCarbon = avgCarbon;
      }
      if (avgCarbon <= cleanThreshold && bestBaseSlot === -1) {
        bestBaseSlot = t;
      }
    }
    // If no window drops below cleanThreshold within staticBuffer, choose the minimum carbon within staticBuffer:
    if (bestBaseSlot === -1) {
      bestBaseSlot = arrival;
      for (let t = arrival; t <= maxBaseSlot; t++) {
        const { avgCarbon } = computeWindowMetrics(t);
        if (avgCarbon === minBaseCarbon) {
          bestBaseSlot = t;
          break;
        }
      }
    }

    const { avgCarbon: baseCarbonVal, avgStd: baseStd } = computeWindowMetrics(bestBaseSlot);
    const baseRisk = UncertaintyService.calculateDeadlineRisk(
      bestBaseSlot,
      dur,
      ddl,
      baseStd,
      uncertaintyMultiplier
    ).violationRisk;
    const overheadBase = Number((performance.now() - startBase).toFixed(2));

    const baselinePolicy: PolicyEvaluationResult = {
      policyId: 'carbon_aware_baseline',
      policyName: 'CarbonAware Baseline',
      category: 'Baseline',
      selectedStartHour: bestBaseSlot,
      selectedEndHour: bestBaseSlot + dur,
      selectedWindow: `T+${bestBaseSlot}:00 to T+${bestBaseSlot + dur}:00`,
      predictedCarbon: baseCarbonVal,
      predictedCarbonIntensity: baseCarbonVal,
      estimatedWorkloadEmissionsGrams: Math.round(baseCarbonVal * energyKwh),
      carbonIntensityUnit: 'gCO2eq/kWh',
      workloadEmissionsUnit: 'gCO2eq',
      estimatedDeadlineRisk: baseRisk,
      waitingTimeHours: bestBaseSlot - arrival,
      isFeasible: bestBaseSlot + dur <= ddl && baseRisk <= tau,
      schedulerOverheadMs: overheadBase,
      rationale: `Conventional heuristic: dispatches at earliest window (T+${bestBaseSlot}:00, ${baseCarbonVal} gCO2eq/kWh) satisfying clean threshold (<= ${cleanThreshold} gCO2eq/kWh) while keeping static ${staticBuffer}h safety margin.`,
    };

    // -------------------------------------------------------------
    // FULL CANDIDATE WINDOWS EVALUATION & CLASSIFICATION
    // Evaluates every possible execution window that can fit before the deadline
    // -------------------------------------------------------------
    const startCr = performance.now();
    const candidateWindows: CandidateWindowEvaluation[] = [];
    const maxEvaluationHour = Math.min(horizon - dur, ddl - dur);

    for (let t = arrival; t <= maxEvaluationHour; t++) {
      const { avgCarbon, avgStd } = computeWindowMetrics(t);
      const startHour = t;
      const endHour = t + dur;
      const windowLabel = `T+${startHour}:00 → T+${endHour}:00`;
      const meetsDeadline = endHour <= ddl;
      const slackHours = ddl - endHour;
      const waitingTimeHours = startHour - arrival;
      const predictedCarbonImpactGrams = Math.round(avgCarbon * energyKwh);
      const uncertaintyRange =
        avgStd === null ? `${avgCarbon} gCO2/kWh (no forecast uncertainty available)` : `${avgCarbon} ± ${avgStd} gCO2/kWh`;

      let deadlineRisk = 1.0;
      if (meetsDeadline) {
        deadlineRisk = UncertaintyService.calculateDeadlineRisk(
          t,
          dur,
          ddl,
          avgStd,
          uncertaintyMultiplier
        ).violationRisk;
      }

      let classification: CandidateWindowEvaluation['classification'];
      let classificationLabel: string;
      let isFeasible = false;
      let reason = '';

      if (!meetsDeadline) {
        classification = 'REJECTED_DEADLINE_BREACH';
        classificationLabel = 'REJECTED — MISSES DEADLINE';
        isFeasible = false;
        reason = `Infeasible: A ${dur}h workload starting at T+${startHour}:00 finishes at T+${endHour}:00, which breaches the T+${ddl}:00 deadline by ${Math.abs(slackHours)} hour(s).`;
      } else if (deadlineRisk > tau) {
        classification = 'REJECTED_HIGH_RISK';
        classificationLabel = 'REJECTED';
        isFeasible = false;
        reason = `Risk exceeds ${(tau * 100).toFixed(0)}% tolerance (${(deadlineRisk * 100).toFixed(1)}% deadline-miss risk)`;
      } else {
        classification = 'FEASIBLE';
        classificationLabel = 'FEASIBLE';
        isFeasible = true;
        reason = `Feasible option: ${avgCarbon} gCO2/kWh with ${(deadlineRisk * 100).toFixed(1)}% deadline risk (within ${(tau * 100).toFixed(0)}% tolerance)`;
      }

      candidateWindows.push({
        slotIndex: t,
        startHour,
        endHour,
        windowLabel,
        predictedCarbonIntensity: avgCarbon,
        predictedCarbonImpactGrams,
        stdDev: avgStd,
        uncertaintyRange,
        deadlineRisk,
        deadlineRiskPct: `${(deadlineRisk * 100).toFixed(1)}%`,
        slackHours,
        waitingTimeHours,
        isFeasible,
        meetsDeadline,
        classification,
        classificationLabel,
        reason,
      });
    }

    // -------------------------------------------------------------
    // POLICY 5: CarbonRoute Uncertainty-Aware (Constrained Optimization)
    // Select the lowest expected carbon window among feasible candidates
    // -------------------------------------------------------------
    const feasibleCandidates = candidateWindows.filter((w) => w.isFeasible);
    let optimalCandidate: CandidateWindowEvaluation;

    if (feasibleCandidates.length > 0) {
      // Find candidate with lowest carbon intensity (tie-break earlier start)
      optimalCandidate = feasibleCandidates.reduce((best, cur) => {
        if (cur.predictedCarbonIntensity < best.predictedCarbonIntensity) return cur;
        if (cur.predictedCarbonIntensity === best.predictedCarbonIntensity && cur.startHour < best.startHour) return cur;
        return best;
      }, feasibleCandidates[0]);

      optimalCandidate.classification = 'RECOMMENDED';
      optimalCandidate.classificationLabel = 'RECOMMENDED';
      optimalCandidate.reason = `Lowest expected-carbon candidate among all windows satisfying the deadline and risk constraints.`;
    } else {
      // Safety fallback if no candidate satisfies tau: pick the deadline-compliant window with lowest risk
      const deadlineCompliant = candidateWindows.filter((w) => w.meetsDeadline);
      optimalCandidate = (deadlineCompliant.length > 0 ? deadlineCompliant : candidateWindows).reduce((safest, cur) => {
        return cur.deadlineRisk < safest.deadlineRisk ? cur : safest;
      }, candidateWindows[0]);

      optimalCandidate.classification = 'RECOMMENDED';
      optimalCandidate.classificationLabel = 'RECOMMENDED';
      optimalCandidate.reason = `Safety fallback: No window satisfied your strict ${(tau * 100).toFixed(0)}% risk tolerance given deadline T+${ddl}:00. Selected lowest-risk candidate (T+${optimalCandidate.startHour}:00, risk: ${optimalCandidate.deadlineRiskPct}) to preserve SLA viability.`;
    }

    const overheadCr = Number((performance.now() - startCr).toFixed(2));

    const carbonRoutePolicy: PolicyEvaluationResult = {
      policyId: 'carbonroute_uncertainty',
      policyName: 'CarbonRoute Uncertainty-Aware',
      category: 'Uncertainty-Aware',
      selectedStartHour: optimalCandidate.startHour,
      selectedEndHour: optimalCandidate.endHour,
      selectedWindow: optimalCandidate.windowLabel,
      predictedCarbon: optimalCandidate.predictedCarbonIntensity,
      predictedCarbonIntensity: optimalCandidate.predictedCarbonIntensity,
      estimatedWorkloadEmissionsGrams: optimalCandidate.predictedCarbonImpactGrams,
      carbonIntensityUnit: 'gCO2eq/kWh',
      workloadEmissionsUnit: 'gCO2eq',
      estimatedDeadlineRisk: optimalCandidate.deadlineRisk,
      waitingTimeHours: optimalCandidate.waitingTimeHours,
      isFeasible: optimalCandidate.isFeasible,
      schedulerOverheadMs: overheadCr,
      rationale: optimalCandidate.reason,
    };

    const evaluatedPolicies = [
      immediatePolicy,
      edfPolicy,
      detPolicy,
      baselinePolicy,
      carbonRoutePolicy,
    ];

    const carbonSavingsPct =
      immCarbon > 0
        ? Number((((immCarbon - optimalCandidate.predictedCarbonIntensity) / immCarbon) * 100).toFixed(1))
        : 0;

    // -------------------------------------------------------------
    // RESEARCH INSIGHT: Lowest Predicted Carbon vs Safest Feasible
    // Explicitly demonstrates why the lowest-carbon window is not always the safest choice
    // -------------------------------------------------------------
    const lowestCarbonCandidate = candidateWindows.reduce((lowest, cur) => {
      if (cur.predictedCarbonIntensity < lowest.predictedCarbonIntensity) return cur;
      if (cur.predictedCarbonIntensity === lowest.predictedCarbonIntensity && cur.startHour < lowest.startHour) return cur;
      return lowest;
    }, candidateWindows[0]);

    const isLowestCarbonSafe = lowestCarbonCandidate.deadlineRisk <= tau;
    const carbonInsurancePenaltyGramsPerKwh = Math.max(
      0,
      optimalCandidate.predictedCarbonIntensity - lowestCarbonCandidate.predictedCarbonIntensity
    );

    let researchInsightExplanation = '';
    if (!isLowestCarbonSafe) {
      researchInsightExplanation = `The candidate window with the absolute lowest predicted grid carbon intensity is ${lowestCarbonCandidate.windowLabel} (${lowestCarbonCandidate.predictedCarbonIntensity} gCO2eq/kWh). However, due to lookahead forecast uncertainty (sigma ~ ±${lowestCarbonCandidate.stdDev} gCO2/kWh) and tight completion slack (${lowestCarbonCandidate.slackHours}h remaining before deadline T+${ddl}:00), its deadline-violation risk rises to ${lowestCarbonCandidate.deadlineRiskPct}, exceeding your ${(tau * 100).toFixed(0)}% risk tolerance. A greedy deterministic scheduler selects this risky cliff and suffers SLA breaches. In contrast, CarbonRoute rejects it and selects ${optimalCandidate.windowLabel} (${optimalCandidate.predictedCarbonIntensity} gCO2eq/kWh, ${optimalCandidate.deadlineRiskPct} risk), accepting an insurance margin of +${carbonInsurancePenaltyGramsPerKwh} gCO2eq/kWh to guarantee safe, on-time completion within your risk tolerance.`;
    } else {
      researchInsightExplanation = `The candidate window with the lowest predicted grid carbon intensity is ${lowestCarbonCandidate.windowLabel} (${lowestCarbonCandidate.predictedCarbonIntensity} gCO2eq/kWh). Its deadline-violation risk is ${lowestCarbonCandidate.deadlineRiskPct}, which is safely within your ${(tau * 100).toFixed(0)}% risk tolerance. CarbonRoute confirms that this window is both optimal and safe.`;
    }

    const researchInsight: ResearchInsightLowestVsSafest = {
      lowestCarbonWindow: lowestCarbonCandidate,
      recommendedWindow: optimalCandidate,
      isLowestCarbonSafe,
      carbonInsurancePenaltyGramsPerKwh,
      explanation: researchInsightExplanation,
    };

    return {
      job,
      carbonSource: source,
      dataMode,
      region,
      candidateWindows,
      evaluatedPolicies,
      recommendedDecision: carbonRoutePolicy,
      comparisonSummary: {
        carbonSavingsVsImmediatePct: carbonSavingsPct,
        delayPenaltyHours: optimalCandidate.waitingTimeHours,
        riskDifferenceVsDeterministic: Number(((detRisk - optimalCandidate.deadlineRisk) * 100).toFixed(1)),
      },
      researchInsight,
      riskModel,
    };
  }
}

// Export top-level function matching specification
export function evaluateAllPolicies(
  job: WorkloadJob,
  forecast: CarbonForecastData | HourlyCarbonPoint[],
  uncertaintyMultiplier?: number
): SchedulingDecisionResponse {
  return SchedulerService.evaluateAllPolicies(job, forecast, uncertaintyMultiplier);
}

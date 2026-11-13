/**
 * Structured explanation of a scheduling decision (P4, plan M10.7).
 *
 * Built only from the engine outcome, so it cannot disagree with the decision. It states the
 * objective, the constraints and which one was binding, how many candidate windows each
 * check removed, and how each other policy's choice relates to the recommendation.
 */
import type { CandidateWindowEvaluation, PolicyEvaluationResult, UnavailablePolicy } from './schedulerService';

export type BindingConstraint = 'none' | 'risk-tolerance' | 'deadline' | 'data-gaps';

export interface DecisionExplanation {
  objective: string;
  constraints: { name: string; value: string }[];
  candidates: { total: number; feasible: number; rejectedHighRisk: number; rejectedDataGap: number };
  /** Which constraint stopped CarbonRoute from choosing the lowest-forecast window. */
  bindingConstraint: BindingConstraint;
  summary: string;
  policies: { policyId: string; relation: string }[];
  unavailable: UnavailablePolicy[];
}

interface ExplainInput {
  status: 'RECOMMENDED' | 'INFEASIBLE_RISK' | 'NO_FEASIBLE_WINDOW';
  reason?: string;
  riskModel: 'deterministic' | 'declared-runtime-cv';
  runtimeCv: number;
  riskTolerance: number;
  deadlineHours: number;
  durationHours: number;
  candidateWindows: CandidateWindowEvaluation[];
  evaluatedPolicies: PolicyEvaluationResult[];
  unavailablePolicies: UnavailablePolicy[];
  recommendedDecision: PolicyEvaluationResult | null;
  /** Wall-clock deadline text (e.g. "2026-11-14 06:40 UTC"); defaults to the slot index. */
  deadlineLabel?: string;
  /** What the intensities in the text are (shown so readers can match them to tables). */
  intensityBasis?: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function explainDecision(o: ExplainInput): DecisionExplanation {
  const c = o.candidateWindows;
  const candidates = {
    total: c.length,
    feasible: c.filter((w) => w.classification === 'FEASIBLE' || w.classification === 'RECOMMENDED').length,
    rejectedHighRisk: c.filter((w) => w.classification === 'REJECTED_HIGH_RISK').length,
    rejectedDataGap: c.filter((w) => w.classification === 'REJECTED_DATA_GAP').length,
  };
  const constraints = [
    { name: 'Deadline', value: `the window must end by ${o.deadlineLabel ?? `slot T+${o.deadlineHours}`} (${o.durationHours} h job)` },
    { name: 'Deadline-miss risk', value: `at most ${pct(o.riskTolerance)}` },
    {
      name: 'Risk model',
      value: o.riskModel === 'deterministic' ? 'deterministic runtime (no runtime variability declared)' : `declared runtime CV ${o.runtimeCv}`,
    },
  ];
  const greedy = o.evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon');
  const rec = o.recommendedDecision;

  let binding: BindingConstraint;
  let summary: string;
  if (o.status === 'NO_FEASIBLE_WINDOW') {
    binding = candidates.total > 0 && candidates.rejectedDataGap === candidates.total ? 'data-gaps' : 'deadline';
    summary = o.reason || 'No window can be evaluated.';
  } else if (o.status === 'INFEASIBLE_RISK') {
    binding = 'risk-tolerance';
    summary = o.reason || 'No window meets the deadline-risk tolerance; no recommendation is made.';
  } else if (rec && greedy && greedy.selectedStartHour !== rec.selectedStartHour) {
    binding = 'risk-tolerance';
    summary = `The lowest-forecast window (${greedy.selectedWindow}, ${greedy.predictedCarbonIntensity} gCO2eq/kWh) has a deadline-miss risk of ${pct(greedy.estimatedDeadlineRisk)}, above the tolerance, so CarbonRoute recommends ${rec.selectedWindow} (${rec.predictedCarbonIntensity} gCO2eq/kWh, risk ${pct(rec.estimatedDeadlineRisk)}).`;
  } else if (rec) {
    binding = candidates.rejectedDataGap > 0 ? 'data-gaps' : 'none';
    summary = `${rec.selectedWindow} has the lowest forecast intensity (${rec.predictedCarbonIntensity} gCO2eq/kWh) of the ${candidates.total} windows that end by the deadline, and its deadline-miss risk (${pct(rec.estimatedDeadlineRisk)}) is within the tolerance.${candidates.rejectedDataGap ? ` ${candidates.rejectedDataGap} window(s) with missing forecast data were not evaluated.` : ''}`;
  } else {
    binding = 'none';
    summary = 'No decision.';
  }

  const policies = o.evaluatedPolicies
    .filter((p) => p.policyId !== 'carbonroute_uncertainty')
    .map((p) => {
      let relation: string;
      if (p.equivalentTo) relation = `Same window as ${p.equivalentTo} (single job).`;
      else if (!rec) relation = p.isFeasible ? 'Meets the tolerance, but CarbonRoute made no recommendation.' : 'Does not meet the risk tolerance.';
      else if (p.selectedStartHour === rec.selectedStartHour) relation = 'Chooses the same window as CarbonRoute.';
      else {
        const diff = p.predictedCarbonIntensity - rec.predictedCarbonIntensity;
        relation = `${diff >= 0 ? `${diff.toFixed(2)} gCO2eq/kWh higher` : `${(-diff).toFixed(2)} gCO2eq/kWh lower`} forecast than CarbonRoute${p.isFeasible ? '' : ', but above the risk tolerance'}.`;
      }
      return { policyId: p.policyId, relation };
    });

  if (o.intensityBasis) constraints.push({ name: 'Intensities in this explanation', value: o.intensityBasis });
  return {
    objective: 'Minimise forecast carbon intensity of the run window, subject to the deadline and the deadline-miss risk tolerance.',
    constraints,
    candidates,
    bindingConstraint: binding,
    summary,
    policies,
    unavailable: o.unavailablePolicies,
  };
}

/**
 * [legacy] Port of tests/prototype_vertical_slice_test.cjs.
 *
 * These are characterization tests: they record the CURRENT behaviour of the
 * scheduling, uncertainty and Kubernetes services, including behaviour the audit
 * found invalid (e.g. the deadline-risk model, audit C1; random realized carbon,
 * audit C2). They may only be changed by the PR that intentionally removes that
 * behaviour, citing the audit finding (see test/README.md).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// Never touch a real cluster from tests: make every kubectl call fail so the
// connector takes its offline path (the original script relied on no cluster existing).
vi.mock('child_process', () => ({
  exec: (_cmd: string, cb: (err: Error | null, out?: unknown) => void) =>
    cb(new Error('kubectl disabled in tests')),
  // kubectl is called through execFile (argument arrays) since P0/F10.
  execFile: (...args: unknown[]) =>
    (args[args.length - 1] as (err: Error | null) => void)(new Error('kubectl disabled in tests')),
}));

import { getForecast, CarbonForecastData } from '../../src/services/carbonService';
import {
  UncertaintyService,
  calculateDeadlineRisk,
  calculateHorizonStdDev,
} from '../../src/services/uncertaintyService';
import { evaluateAllPolicies, WorkloadJob } from '../../src/services/schedulerService';
import { K8sConnector, generateJobManifest, dispatchJob } from '../../src/services/k8sConnector';

const baseJob: WorkloadJob = {
  id: 'test-job-base',
  name: 'ResNet-50 Batch Training',
  commandOrImage: 'carbonroute/test-workload:latest',
  isContainerImage: true,
  durationHours: 2,
  deadlineHours: 12,
  arrivalHour: 0,
  cpu: 2,
  memoryMb: 1024,
  region: 'US-CAL-CISO',
  riskTolerance: 0.05,
  status: 'pending',
  createdAt: new Date().toISOString(),
};

describe('[legacy] prototype vertical slice', () => {
  let forecastData: CarbonForecastData;

  beforeAll(async () => {
    forecastData = await getForecast('US-CAL-CISO', 24, 'demo');
  });

  it('exports the top-level functions', () => {
    for (const fn of [getForecast, calculateDeadlineRisk, calculateHorizonStdDev, evaluateAllPolicies, generateJobManifest, dispatchJob]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('Step 1: demo forecast returns 24 hourly points with predictedCarbon and stdDev', () => {
    expect(forecastData.hourlyProfile).toHaveLength(24);
    const p0 = forecastData.hourlyProfile[0];
    expect(typeof p0.predictedCarbon).toBe('number');
    expect(typeof p0.stdDev).toBe('number');
  });

  it('Step 2: horizon sigma grows monotonically', () => {
    const s = [0, 6, 12, 24].map((h) => UncertaintyService.calculateHorizonStdDev(h, 15));
    expect(s[0]).toBeLessThan(s[1]);
    expect(s[1]).toBeLessThan(s[2]);
    expect(s[2]).toBeLessThan(s[3]);
  });

  it('Step 3: deadline risk is bounded and 1.0 for a deterministic breach', () => {
    const riskSafe = UncertaintyService.calculateDeadlineRisk(0, 4, 16, 15, 1.0).violationRisk;
    const riskRisky = UncertaintyService.calculateDeadlineRisk(11, 4, 16, 15, 1.0).violationRisk;
    const riskBreach = UncertaintyService.calculateDeadlineRisk(13, 4, 16, 15, 1.0).violationRisk;
    expect(riskSafe).toBeLessThanOrEqual(0.05);
    expect(riskRisky).toBeGreaterThan(riskSafe);
    expect(riskBreach).toBe(1.0);
  });

  it('Test A: base case evaluates 5 policies, generates a manifest and completes a sandbox dispatch', async () => {
    const decision = evaluateAllPolicies(baseJob, forecastData, 1.0);
    expect(decision.evaluatedPolicies).toHaveLength(5);

    const immediate = decision.evaluatedPolicies.find((p) => p.policyId === 'immediate')!;
    const rec = decision.recommendedDecision;
    expect(rec.predictedCarbon).toBeLessThan(immediate.predictedCarbon);
    expect(rec.estimatedDeadlineRisk).toBeLessThanOrEqual(0.051);

    const manifest = generateJobManifest(baseJob, rec.selectedStartHour, 'carbonroute-job-testa');
    expect(manifest.apiVersion).toBe('batch/v1');
    expect(manifest.kind).toBe('Job');

    const execution = await dispatchJob(baseJob, rec, undefined, undefined, undefined, undefined, 2);
    expect(execution.jobId).toBe(baseJob.id);
    expect(execution.clusterMode).toBe('offline_fallback');

    let status = K8sConnector.getExecutionStatus(baseJob.id);
    for (let i = 0; i < 40 && status?.status !== 'completed' && status?.status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 150));
      status = K8sConnector.getExecutionStatus(baseJob.id);
    }
    expect(status?.status).toBe('completed');
    // Changed in M5 (audit C2, task M2.1): realized carbon used to be a random perturbation of
    // the prediction. It is no longer invented; it comes only from provider observations.
    expect(status?.realizedCarbon).toBeUndefined();
    expect(status?.carbonError).toBeUndefined();
    expect(status?.carbonObservation).toBe('collect-from-provider-after-window');
  });

  it('Test B: higher uncertainty multiplier keeps carbon values and does not pick a later window', () => {
    const run1 = evaluateAllPolicies(baseJob, forecastData, 1.0);
    const run2 = evaluateAllPolicies(baseJob, forecastData, 2.4);
    expect(run2.evaluatedPolicies.map((p) => p.predictedCarbon)).toEqual(
      run1.evaluatedPolicies.map((p) => p.predictedCarbon)
    );

    const risk1 = calculateDeadlineRisk(8, 2, 12, 15, 1.0).violationRisk;
    const risk2 = calculateDeadlineRisk(8, 2, 12, 15, 2.4).violationRisk;
    expect(risk2).toBeGreaterThan(risk1);

    expect(run2.recommendedDecision.selectedStartHour).toBeLessThanOrEqual(run1.recommendedDecision.selectedStartHour);
    expect(run2.recommendedDecision.rationale.length).toBeGreaterThanOrEqual(20);
  });

  it('Test C: a 6h job with a 12h deadline never starts after T+6', () => {
    const dec6h = evaluateAllPolicies({ ...baseJob, id: 'job-c-6h', durationHours: 6 }, forecastData, 1.0);
    const det6h = dec6h.evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon')!;
    expect(det6h.selectedStartHour).toBeLessThanOrEqual(6);
  });

  it('Test D: less slack means higher risk, and an 8h deadline never starts after T+6', () => {
    const riskSlack4 = calculateDeadlineRisk(6, 2, 12, 15, 1.0).violationRisk;
    const riskSlack0 = calculateDeadlineRisk(6, 2, 8, 15, 1.0).violationRisk;
    expect(riskSlack0).toBeGreaterThan(riskSlack4);
    const dec8h = evaluateAllPolicies({ ...baseJob, id: 'job-d-8h', deadlineHours: 8 }, forecastData, 1.0);
    expect(dec8h.recommendedDecision.selectedStartHour).toBeLessThanOrEqual(6);
  });

  it('Test E: strict 1% tolerance is respected by the recommendation', () => {
    const decStrict = evaluateAllPolicies({ ...baseJob, id: 'job-e-strict', riskTolerance: 0.01 }, forecastData, 1.0);
    expect(decStrict.recommendedDecision.estimatedDeadlineRisk).toBeLessThanOrEqual(0.011);
  });

  it('Test F: candidate windows are fully populated and exactly one is RECOMMENDED', () => {
    const windows = evaluateAllPolicies(baseJob, forecastData, 1.0).candidateWindows;
    expect(windows.length).toBeGreaterThan(0);
    let recommended = 0;
    for (const w of windows) {
      expect(typeof w.slotIndex).toBe('number');
      expect(w.predictedCarbonIntensity).toBeGreaterThan(0);
      expect(w.predictedCarbonImpactGrams).toBeGreaterThan(0);
      expect(w.stdDev).toBeGreaterThan(0);
      expect(w.uncertaintyRange).toContain('±');
      expect(w.deadlineRisk).toBeGreaterThanOrEqual(0);
      expect(w.deadlineRisk).toBeLessThanOrEqual(1);
      expect(w.deadlineRiskPct).toContain('%');
      expect(w.reason.length).toBeGreaterThanOrEqual(10);
      expect(['RECOMMENDED', 'FEASIBLE', 'REJECTED_HIGH_RISK', 'REJECTED_DEADLINE_BREACH']).toContain(w.classification);
      if (!w.meetsDeadline) expect(w.classification).toBe('REJECTED_DEADLINE_BREACH');
      if (w.meetsDeadline && w.deadlineRisk > baseJob.riskTolerance) expect(w.classification).toBe('REJECTED_HIGH_RISK');
      if (w.isFeasible) expect(['RECOMMENDED', 'FEASIBLE']).toContain(w.classification);
      if (w.classification === 'RECOMMENDED') recommended++;
    }
    expect(recommended).toBe(1);
  });

  it('Test G: cases A-D produce the expected candidate-window counts and respect tau', () => {
    const jobA: WorkloadJob = { ...baseJob, id: 'job-case-a', durationHours: 3, riskTolerance: 0.02 };
    const decA = evaluateAllPolicies(jobA, forecastData, 1.0);
    expect(decA.candidateWindows).toHaveLength(10);
    const lastWinA = decA.candidateWindows[9];
    expect(lastWinA.windowLabel).toBe('T+9:00 → T+12:00');
    expect(lastWinA.deadlineRisk).toBeGreaterThanOrEqual(0.49);
    expect(lastWinA.isFeasible).toBe(false);
    const detA = decA.evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon')!;
    if (detA.estimatedDeadlineRisk > 0.02) expect(detA.isFeasible).toBe(false);
    expect(decA.recommendedDecision.estimatedDeadlineRisk).toBeLessThanOrEqual(0.0201);

    const decB = evaluateAllPolicies({ ...jobA, id: 'job-case-b', riskTolerance: 0.5 }, forecastData, 1.0);
    const detB = decB.evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon')!;
    if (detB.estimatedDeadlineRisk <= 0.5) expect(detB.isFeasible).toBe(true);

    const decC = evaluateAllPolicies({ ...jobA, id: 'job-case-c', durationHours: 6 }, forecastData, 1.0);
    expect(decC.candidateWindows).toHaveLength(7);

    const decD = evaluateAllPolicies({ ...jobA, id: 'job-case-d', deadlineHours: 8 }, forecastData, 1.0);
    expect(decD.candidateWindows).toHaveLength(6);
  });

  it('Test H: BENCHMARK-RESEARCH trace produces the hand-designed policy divergence (audit C1/H9)', async () => {
    const benchmark = await getForecast('BENCHMARK-RESEARCH', 24, 'demo');
    expect(benchmark.hourlyProfile).toHaveLength(24);
    const dec = evaluateAllPolicies(
      { ...baseJob, id: 'job-research-benchmark', region: 'BENCHMARK-RESEARCH' },
      benchmark,
      1.0
    );
    const byId = Object.fromEntries(dec.evaluatedPolicies.map((p) => [p.policyId, p]));
    expect(dec.evaluatedPolicies).toHaveLength(5);

    expect(byId.immediate.selectedStartHour).toBe(0);
    expect(byId.immediate.isFeasible).toBe(true);
    expect(byId.edf.selectedStartHour).toBe(0);
    expect(byId.edf.isFeasible).toBe(true);
    expect(byId.deterministic_carbon.selectedStartHour).toBe(10);
    expect(byId.deterministic_carbon.isFeasible).toBe(false);
    expect(byId.carbon_aware_baseline.selectedStartHour).toBeGreaterThanOrEqual(1);
    expect(byId.carbon_aware_baseline.selectedStartHour).toBeLessThanOrEqual(3);
    expect(byId.carbon_aware_baseline.isFeasible).toBe(true);
    expect(byId.carbonroute_uncertainty.selectedStartHour).toBe(2);
    expect(byId.carbonroute_uncertainty.isFeasible).toBe(true);
    expect(byId.carbonroute_uncertainty.estimatedDeadlineRisk).toBeLessThanOrEqual(0.05);

    const ri = dec.researchInsight!;
    expect(ri.lowestCarbonWindow.windowLabel).toBe('T+10:00 → T+12:00');
    expect(ri.isLowestCarbonSafe).toBe(false);
    expect(ri.recommendedWindow.windowLabel).toBe('T+2:00 → T+4:00');
    expect(ri.carbonInsurancePenaltyGramsPerKwh).toBeGreaterThan(0);
    expect(ri.explanation.length).toBeGreaterThanOrEqual(20);
  });
});

/**
 * P1: scheduling engine correctness. Every expected value below is computed by hand in the
 * comments (hourly slots, d = duration, D = deadline slot, cv = declared runtime CV).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { SchedulerService, EngineInfeasibleError, WorkloadJob, EngineOutcome } from '../../src/services/schedulerService';
import { UncertaintyService, normalCdf } from '../../src/services/uncertaintyService';
import { evaluateOracle } from '../../src/evaluation/oracle';
import { energyAssumption } from '../../src/services/energyModel';
import { createAndLoginUser } from '../support/auth';

const pts = (values: (number | null)[]) =>
  values.map((v, i) => ({
    hour: i,
    timestamp: new Date(Date.UTC(2026, 10, 14, i)).toISOString(),
    predictedCarbon: v as number,
    carbonIntensity: v as number,
    stdDev: null,
    uncertaintyStdDev: null,
  })) as any[];

const job = (over: Partial<WorkloadJob> = {}): WorkloadJob => ({
  id: 'job-engine',
  name: 'engine test',
  commandOrImage: 'busybox',
  isContainerImage: true,
  durationHours: 2,
  deadlineHours: 8,
  arrivalHour: 0,
  cpu: 2,
  memoryMb: 256,
  region: 'TEST',
  riskTolerance: 0.05,
  createdAt: '2026-11-14T00:00:00.000Z',
  ...over,
});

// F: window averages for d = 2:
// t0 (300+200)/2=250, t1 150, t2 175, t3 150, t4 225, t5 260, t6 100
const F = pts([300, 200, 100, 250, 50, 400, 120, 80]);
const recommended = (o: EngineOutcome) => {
  if (o.status !== 'RECOMMENDED') throw new Error(`expected RECOMMENDED, got ${o.status}: ${o.reason}`);
  return o;
};
const byId = (o: EngineOutcome) => Object.fromEntries(o.evaluatedPolicies.map((p) => [p.policyId, p]));

describe('deadline risk (runtime only)', () => {
  it('is deterministic without a declared runtime CV', () => {
    expect(UncertaintyService.deadlineRisk(6, 2, 8, 0)).toMatchObject({ violationRisk: 0, model: 'deterministic', slackHours: 0 });
    expect(UncertaintyService.deadlineRisk(7, 2, 8, 0).violationRisk).toBe(1);
  });

  it('is 1 - Phi(slack / (cv * d)) with a declared CV', () => {
    // d = 2, cv = 0.25 -> sigma = 0.5 h; slack 1 h -> z = 2 -> 1 - Phi(2) = 0.022750
    expect(UncertaintyService.deadlineRisk(5, 2, 8, 0.25).violationRisk).toBeCloseTo(0.02275, 5);
    // zero slack -> 0.5 exactly
    expect(UncertaintyService.deadlineRisk(6, 2, 8, 0.25).violationRisk).toBeCloseTo(0.5, 7);
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
  });

  it('does not depend on carbon values at all', () => {
    const a = SchedulerService.evaluatePolicies(job(), pts([300, 200, 100, 250, 50, 400, 120, 80]), { runtimeCv: 0.25 });
    const b = SchedulerService.evaluatePolicies(job(), pts([1, 999, 1, 999, 1, 999, 1, 999]), { runtimeCv: 0.25 });
    expect(a.candidateWindows.map((w) => w.deadlineRisk)).toEqual(b.candidateWindows.map((w) => w.deadlineRisk));
  });
});

describe('policies on a hand-computed forecast (cv = 0)', () => {
  const out = () => recommended(SchedulerService.evaluatePolicies(job(), F));

  it('Immediate = slot 0 (250); EDF identical and labelled as such', () => {
    const p = byId(out());
    expect(p.immediate).toMatchObject({ selectedStartHour: 0, predictedCarbonIntensity: 250, waitingTimeHours: 0 });
    expect(p.edf).toMatchObject({ selectedStartHour: 0, predictedCarbonIntensity: 250, equivalentTo: 'immediate' });
    expect(p.edf.rationale).toMatch(/single job/);
  });

  it('Greedy and CarbonRoute pick the minimum (slot 6, 100); emissions use the shared energy model', () => {
    const o = out();
    const p = byId(o);
    expect(p.deterministic_carbon.selectedStartHour).toBe(6);
    expect(p.carbonroute_uncertainty.selectedStartHour).toBe(6);
    // energy = 2 vCPU x 0.125 kW x 2 h = 0.5 kWh -> 100 x 0.5 = 50 g
    expect(energyAssumption(2, 2).energyKwh).toBe(0.5);
    expect(p.carbonroute_uncertainty.estimatedWorkloadEmissionsGrams).toBe(50);
    // (250 - 100) / 250 = 60 %
    expect(o.comparisonSummary.carbonSavingsVsImmediatePct).toBe(60);
    expect(o.recommendedDecision.selectedEndHour).toBeLessThanOrEqual(8);
  });

  it('CarbonAware baseline: threshold is the 25th percentile of the windows it may choose (D6)', () => {
    // planned slack 6 -> buffer round(1.5) = 2 -> starts allowed up to 8 - 2 - 2 = 4
    // pool t0..t4 = [250,150,175,150,225] -> sorted [150,150,175,225,250], index 1 -> 150 -> earliest t1
    const p = byId(out());
    expect(p.carbon_aware_baseline.selectedStartHour).toBe(1);
    expect(p.carbon_aware_baseline.rationale).toMatch(/150 gCO2eq\/kWh/);
  });

  it('the old all-horizon threshold would have picked a different window (D6 regression)', () => {
    // d = 1, D = 5: buffer 1 -> pool t0..t3 = [150,120,100,300]; 25th pct of the pool = 120 -> t1.
    // The old threshold used all 8 points (incl. the 10s after the deadline) -> 10 -> fallback min t2.
    const o = recommended(SchedulerService.evaluatePolicies(job({ durationHours: 1, deadlineHours: 5 }), pts([150, 120, 100, 300, 10, 10, 10, 10])));
    expect(byId(o).carbon_aware_baseline.selectedStartHour).toBe(1);
  });

  it('cost-aware and oracle are reported as unavailable with reasons, never invented', () => {
    const o = out();
    expect(o.unavailablePolicies.map((u) => u.policyId)).toEqual(['cost_aware', 'oracle']);
    expect(o.evaluatedPolicies.some((p) => p.policyId === 'cost_aware' || p.policyId === 'oracle')).toBe(false);
  });
});

describe('risk-constrained decisions (cv = 0.25)', () => {
  it('rejects the zero-slack minimum and picks the best window within tolerance', () => {
    // sigma = 0.5 h. t6 slack 0 -> 50 % > 5 % rejected; t5 slack 1 -> 2.3 % feasible (260);
    // t3 slack 3 (150) and t1 slack 5 (150) feasible -> min 150, tie -> earliest t1.
    const o = recommended(SchedulerService.evaluatePolicies(job(), F, { runtimeCv: 0.25 }));
    const p = byId(o);
    expect(o.riskModel).toBe('declared-runtime-cv');
    expect(p.deterministic_carbon).toMatchObject({ selectedStartHour: 6, isFeasible: false });
    expect(p.carbonroute_uncertainty).toMatchObject({ selectedStartHour: 1, predictedCarbonIntensity: 150, isFeasible: true });
    expect(o.candidateWindows.find((w) => w.startHour === 6)!.classification).toBe('REJECTED_HIGH_RISK');
    expect(o.researchInsight).toMatchObject({ isLowestCarbonSafe: false, carbonInsurancePenaltyGramsPerKwh: 50 });
  });

  it('returns INFEASIBLE_RISK instead of a fallback when no window meets the tolerance (D4)', () => {
    // cv 1 -> sigma 2 h; best slack 6 h -> z 3 -> 0.135 % > 0.1 %
    const o = SchedulerService.evaluatePolicies(job({ riskTolerance: 0.001 }), F, { runtimeCv: 1 });
    expect(o.status).toBe('INFEASIBLE_RISK');
    expect(o.recommendedDecision).toBeNull();
    expect(o.candidateWindows.some((w) => w.classification === 'RECOMMENDED')).toBe(false);
    expect(() => SchedulerService.evaluateAllPolicies(job({ riskTolerance: 0.001 }), F, { runtimeCv: 1 })).toThrow(EngineInfeasibleError);
  });

  it('the removed uncertaintyMultiplier argument (a number) is ignored', () => {
    const a = recommended(SchedulerService.evaluatePolicies(job(), F, 2.5));
    expect(a.riskModel).toBe('deterministic');
    expect(a.recommendedDecision.selectedStartHour).toBe(6);
  });
});

describe('no clamping, no wrap-around, no fill-in (D1, D2)', () => {
  it('a missing value excludes every window containing it; nothing is filled with 250', () => {
    // value at slot 6 missing -> windows t5 and t6 are REJECTED_DATA_GAP
    const o = recommended(SchedulerService.evaluatePolicies(job(), pts([300, 200, 100, 250, 50, 400, null, 80])));
    const gaps = o.candidateWindows.filter((w) => w.classification === 'REJECTED_DATA_GAP').map((w) => w.startHour);
    expect(gaps).toEqual([5, 6]);
    expect(o.recommendedDecision.selectedStartHour).toBe(1); // 150, earliest of t1/t3
  });

  it('windows never wrap past the end of the forecast', () => {
    const o = recommended(SchedulerService.evaluatePolicies(job({ deadlineHours: 20 }), F));
    expect(o.candidateWindows.map((w) => w.startHour)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('an impossible deadline is reported, not clamped (deadline before arrival + duration)', () => {
    expect(SchedulerService.evaluatePolicies(job({ arrivalHour: 5, deadlineHours: 6 }), F).status).toBe('NO_FEASIBLE_WINDOW');
    expect(SchedulerService.evaluatePolicies(job({ deadlineHours: 1 }), F).status).toBe('NO_FEASIBLE_WINDOW');
  });

  it('invalid inputs are rejected', () => {
    expect(() => SchedulerService.evaluatePolicies(job({ durationHours: 1.5 }), F)).toThrow(/whole number/);
    expect(() => SchedulerService.evaluatePolicies(job({ riskTolerance: 0 }), F)).toThrow(/riskTolerance/);
    expect(() => SchedulerService.evaluatePolicies(job(), F, { runtimeCv: 2 })).toThrow(/runtimeCv/);
  });
});

describe('exact ranking (D8)', () => {
  it('ranks on exact averages, not integers', () => {
    // d = 2: t0 100.6, t1 100.4, t2 100.3. Rounded, all were 100/101 and the earlier slot won.
    const o = recommended(SchedulerService.evaluatePolicies(job({ deadlineHours: 4 }), pts([101, 100.2, 100.6, 100])));
    expect(o.recommendedDecision.selectedStartHour).toBe(2);
    expect(o.recommendedDecision.predictedCarbonIntensity).toBe(100.3);
  });
});

describe('invariants on seeded random forecasts', () => {
  // Deterministic pseudo-random generator (mulberry32) so failures are reproducible.
  const rng = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  it('recommendation meets deadline and tolerance, is the best feasible window, and Greedy is never worse in forecast', () => {
    const r = rng(42);
    for (let k = 0; k < 300; k++) {
      const n = 6 + Math.floor(r() * 30);
      const values = Array.from({ length: n }, () => (r() < 0.05 ? null : Math.round(50 + r() * 500)));
      const d = 1 + Math.floor(r() * 4);
      const D = d + Math.floor(r() * n);
      const cv = r() < 0.5 ? 0 : r() * 0.5;
      const tau = 0.01 + r() * 0.3;
      const o = SchedulerService.evaluatePolicies(job({ durationHours: d, deadlineHours: D, riskTolerance: tau }), pts(values), { runtimeCv: cv });
      for (const w of o.candidateWindows) {
        expect(w.endHour).toBeLessThanOrEqual(Math.min(n, D));
        expect(w.startHour).toBeGreaterThanOrEqual(0);
      }
      if (o.status !== 'RECOMMENDED') {
        expect(o.candidateWindows.some((w) => w.isFeasible)).toBe(false);
        continue;
      }
      const rec = o.recommendedDecision;
      expect(rec.selectedEndHour).toBeLessThanOrEqual(D);
      expect(rec.estimatedDeadlineRisk).toBeLessThanOrEqual(tau);
      const feasible = o.candidateWindows.filter((w) => w.isFeasible || w.classification === 'RECOMMENDED');
      for (const w of feasible) expect(rec.predictedCarbonIntensity).toBeLessThanOrEqual(w.predictedCarbonIntensity + 0.01);
      const greedy = o.evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon')!;
      expect(greedy.predictedCarbonIntensity).toBeLessThanOrEqual(rec.predictedCarbonIntensity + 0.01);
    }
  });
});

describe('Oracle (offline, realized data only)', () => {
  const H = 3600_000;
  const t0 = Date.UTC(2026, 10, 14, 0);
  const win = (s: number, d = 2) => ({ startUtc: new Date(t0 + s * H).toISOString(), endUtc: new Date(t0 + (s + d) * H).toISOString() });
  const realized = (values: number[]) => values.map((v, i) => ({ datetime: new Date(t0 + i * H).toISOString(), value: v, intervalMinutes: 60 }));

  it('picks the lowest realized window and computes non-negative regret per policy', () => {
    // realized windows: t0 150, t1 175, t2 125, t3 300
    const out = evaluateOracle([win(0), win(1), win(2), win(3)], realized([100, 200, 150, 100, 500]), [
      { policyId: 'immediate', window: win(0) },
      { policyId: 'carbonroute', window: win(3) },
    ]);
    expect(out.status).toBe('AVAILABLE');
    expect(out.offlineOnly).toBe(true);
    expect(out.oracleWindow).toMatchObject({ ...win(2), realizedIntensity: 125 });
    expect(out.policies).toEqual([
      { policyId: 'immediate', window: win(0), realizedIntensity: 150, regretGramsPerKwh: 25 },
      { policyId: 'carbonroute', window: win(3), realizedIntensity: 300, regretGramsPerKwh: 175 },
    ]);
  });

  it('is unavailable unless every candidate window is fully observed', () => {
    const out = evaluateOracle([win(0), win(1), win(2)], realized([100, 200, 150]));
    expect(out.status).toBe('UNAVAILABLE_INCOMPLETE_COVERAGE');
    expect(out).toMatchObject({ candidatesEvaluated: 3, candidatesFullyCovered: 2, oracleWindow: null });
  });

  it('property: oracle realized intensity <= every candidate realized intensity', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let k = 0; k < 100; k++) {
      const n = 4 + Math.floor(r() * 20);
      const vals = Array.from({ length: n + 3 }, () => Math.round(r() * 600));
      const cands = Array.from({ length: n }, (_, i) => win(i, 3));
      const out = evaluateOracle(cands, realized(vals), cands.map((w, i) => ({ policyId: `p${i}`, window: w })));
      expect(out.status).toBe('AVAILABLE');
      for (const p of out.policies) expect(p.regretGramsPerKwh).toBeGreaterThanOrEqual(0);
      expect(Math.min(...out.policies.map((p) => p.regretGramsPerKwh as number))).toBe(0);
    }
  });
});

describe('API', () => {
  let auth: { Authorization: string };
  beforeAll(async () => {
    auth = (await createAndLoginUser(app)).auth;
  });

  it('POST /api/schedule stores an explicit INFEASIBLE_RISK decision (no fallback recommendation)', async () => {
    const deadlineAt = new Date(Date.now() + 4 * 3600_000).toISOString();
    const res = await request(app)
      .post('/api/schedule')
      .set(auth)
      .send({ mode: 'demo', runtimeCv: 1, jobData: { name: 'tight', commandOrImage: 'busybox', durationHours: 2, cpu: 1, riskTolerance: 0.001, region: 'BENCHMARK-RESEARCH', deadlineAt } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('INFEASIBLE_RISK');
    expect(res.body.data.recommendation).toBeNull();
    expect(res.body.data.candidateWindows.length).toBeGreaterThan(0);
    const details = await request(app).get(`/api/jobs/${res.body.data.job.id}`).set(auth);
    expect(details.body.data.decision.status).toBe('INFEASIBLE');
    expect(details.body.data.status).toBe('infeasible');
  });

  it('rejects an out-of-range runtimeCv with 400', async () => {
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const res = await request(app)
      .post('/api/schedule')
      .set(auth)
      .send({ mode: 'demo', runtimeCv: 3, jobData: { name: 'x', commandOrImage: 'busybox', durationHours: 1, cpu: 1, riskTolerance: 0.05, region: 'BENCHMARK-RESEARCH', deadlineAt } });
    expect(res.status).toBe(400);
  });

  it('GET /api/jobs/:id/oracle is not applicable for synthetic decisions', async () => {
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const sched = await request(app)
      .post('/api/schedule')
      .set(auth)
      .send({ mode: 'demo', jobData: { name: 'o', commandOrImage: 'busybox', durationHours: 1, cpu: 1, riskTolerance: 0.05, region: 'BENCHMARK-RESEARCH', deadlineAt } });
    const res = await request(app).get(`/api/jobs/${sched.body.data.job.id}/oracle`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'NOT_APPLICABLE_SYNTHETIC', offlineOnly: true });
  });

  it('feasibility demo: synthetic, validated input, and higher runtime variability never lowers risk', async () => {
    expect((await request(app).post('/api/scheduler/simulate').send({ durationHours: 9 })).status).toBe(400);
    const res = await request(app).post('/api/scheduler/simulate').send({ durationHours: 4, deadlineHours: 12, riskTolerance: 0.01 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dataClass: 'synthetic', riskModel: 'declared-runtime-cv' });
    for (const s of res.body.data.timeSlots) {
      expect(s.uncertaintyHigh.violationRisk).toBeGreaterThanOrEqual(s.uncertaintyLow.violationRisk);
      expect(s.hour + 4).toBeLessThanOrEqual(12);
    }
    const { scenarioA, scenarioB } = res.body.data.scenarios;
    if (scenarioB.selectedStartHour >= 0) expect(scenarioB.estimatedViolationRisk).toBeLessThanOrEqual(0.01);
    if (scenarioA.selectedStartHour >= 0) expect(scenarioA.estimatedViolationRisk).toBeLessThanOrEqual(0.01);
  });
});

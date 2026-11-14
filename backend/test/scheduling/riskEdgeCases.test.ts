/**
 * P16: deadline-risk edge cases, checked against the documented formula
 *   R ~ Normal(d, (cv d)^2),  P(miss) = 1 - Phi((D - t - d) / (cv d))
 * with cv = 0 handled explicitly (deterministic, no division). Risk depends only on the
 * declared runtime variability; carbon forecast uncertainty is not part of it.
 */
import { describe, it, expect } from 'vitest';
import { UncertaintyService, normalCdf, MAX_RUNTIME_CV } from '../../src/services/uncertaintyService';
import { SchedulerService, WorkloadJob } from '../../src/services/schedulerService';

const risk = (t: number, d: number, D: number, cv: number) => UncertaintyService.deadlineRisk(t, d, D, cv);

describe('deadline risk edge cases', () => {
  it('cv = 0: deterministic, 0 if the run ends by the deadline, 1 otherwise, never NaN', () => {
    expect(risk(0, 2, 8, 0)).toEqual({ violationRisk: 0, runtimeStdDevHours: 0, slackHours: 6, model: 'deterministic' });
    expect(risk(7, 2, 8, 0)).toMatchObject({ violationRisk: 1, model: 'deterministic', slackHours: -1 });
    for (const t of [0, 5.5, 6, 6.5, 8, 20]) expect(Number.isNaN(risk(t, 2, 8, 0).violationRisk)).toBe(false);
  });

  it('deadline exactly equals the expected completion: 0 when deterministic, exactly 0.5 with cv > 0', () => {
    expect(risk(6, 2, 8, 0).violationRisk).toBe(0);
    for (const cv of [0.1, 0.2, 0.5, 1]) expect(risk(6, 2, 8, cv).violationRisk).toBeCloseTo(0.5, 7);
  });

  it('deadline earlier than the expected completion: 1 when deterministic, above 0.5 with cv > 0', () => {
    expect(risk(7, 2, 8, 0).violationRisk).toBe(1);
    // slack -1 h, sigma = 0.2 * 2 = 0.4 h -> z = -2.5 -> 1 - Phi(-2.5) = Phi(2.5)
    expect(risk(7, 2, 8, 0.2).violationRisk).toBeCloseTo(normalCdf(2.5), 7);
    expect(risk(7, 2, 8, 0.2).violationRisk).toBeGreaterThan(0.99);
    expect(risk(7, 2, 8, 1).violationRisk).toBeGreaterThan(0.5);
  });

  it('large cv (the maximum, 1): wide but well-defined; values above the maximum are clamped here and rejected by validation', () => {
    expect(MAX_RUNTIME_CV).toBe(1);
    // slack = d = 2 h, sigma = 2 h -> z = 1 -> 1 - Phi(1) = 0.158655
    expect(risk(4, 2, 8, 1).violationRisk).toBeCloseTo(0.158655, 5);
    expect(risk(4, 2, 8, 5).violationRisk).toBeCloseTo(risk(4, 2, 8, 1).violationRisk, 12);
    expect(() => SchedulerService.evaluatePolicies(job(), flat(10), { runtimeCv: 1.5 })).toThrow(/runtimeCv/);
    // larger cv never lowers the risk of a window with positive slack
    expect(risk(4, 2, 8, 1).violationRisk).toBeGreaterThan(risk(4, 2, 8, 0.2).violationRisk);
  });

  it('start at or after the deadline: risk 1 for every cv (the job cannot finish in time)', () => {
    for (const cv of [0, 0.1, 0.5, 1]) {
      expect(risk(8, 2, 8, cv).violationRisk).toBe(1);
      expect(risk(9, 2, 8, cv).violationRisk).toBe(1);
    }
  });

  it('the scheduler only evaluates starts whose window ends by the deadline', () => {
    const out = SchedulerService.evaluatePolicies(job({ deadlineHours: 8, durationHours: 2 }), flat(12), { runtimeCv: 0.2 });
    const starts = out.candidateWindows.map((w) => w.slotIndex);
    expect(Math.max(...starts)).toBe(6);
    for (const w of out.candidateWindows) expect(w.slotIndex + 2).toBeLessThanOrEqual(8);
  });
});

function flat(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    hour: i,
    timestamp: new Date(Date.UTC(2026, 10, 14, i)).toISOString(),
    predictedCarbon: 100 + i,
    carbonIntensity: 100 + i,
    stdDev: null,
    uncertaintyStdDev: null,
  })) as any[];
}

function job(over: Partial<WorkloadJob> = {}): WorkloadJob {
  return {
    id: 'job-edge',
    name: 'edge',
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
  };
}

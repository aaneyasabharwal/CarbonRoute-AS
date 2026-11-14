/**
 * Regression tests for the two defects found in the live demonstration (2026-11-12):
 *
 *  1. The Immediate window (19:49:57 -> 20:49:57 UTC) was evaluated with equal weights per
 *     hourly interval: observed 127 instead of the time-weighted 124.34, and predicted 119
 *     (first hourly point only) instead of the time-weighted 117.33.
 *  2. Assumed-energy emissions were shown under "Realized result" / an "observed comparison".
 *
 * The records below reproduce the stored demo values (US-CAL-CISO forecast 19:00=119,
 * 20:00=117; measured observations 19:00=131, 20:00=123; assumed energy 0.25 kWh) in a
 * temporary store. They are test data mirroring the demo, not new provider data.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import { SchedulingStore } from '../../src/models/schedulingStore';
import { evaluateJob } from '../../src/services/schedulingWorkflow';
import { buildReport, renderReportHtml } from '../../src/services/reportService';
import { assessEmissions, windowIntensity } from '../../src/evaluation/forecastEvaluation';
import type { Observation } from '../../src/carbon/types';

const REC = { startUtc: '2026-11-12T20:00:00.000Z', endUtc: '2026-11-12T21:00:00.000Z' };
const IMM = { startUtc: '2026-11-12T19:49:57.531Z', endUtc: '2026-11-12T20:49:57.531Z' };
const ENERGY = { powerKw: 0.25, energyKwh: 0.25, basis: 'Assumption: 0.125 kW per requested vCPU (minimum 0.1 kW). Not measured.' };

const obs = (datetime: string, value: number, opts: { estimated?: boolean; factor?: 'lifecycle' | 'direct' } = {}): Observation => ({
  zone: 'US-CAL-CISO',
  datetime,
  granularity: 'hourly',
  carbonIntensity: value,
  isEstimated: !!opts.estimated,
  estimationMethod: opts.estimated ? 'FORECASTS_HIERARCHY' : null,
  quality: opts.estimated ? 'provider-estimate' : 'measured',
  emissionFactorType: opts.factor ?? 'lifecycle',
  providerUpdatedAt: null,
  fetchedAt: '2026-11-12T21:26:04.564Z',
  provider: 'electricitymaps',
});

function demoStore(opts: { immediateObs?: Observation[]; recObs?: Observation[]; measuredEnergyKwh?: number } = {}) {
  const store = new SchedulingStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-test-rc-')), 'sched.json'));
  const job = store.addJob({
    name: 'demo replica', commandOrImage: 'x', isContainerImage: true, zone: 'US-CAL-CISO', durationHours: 1, cpu: 2, memoryMb: 1024,
    riskTolerance: 0.05, arrivalAt: IMM.startUtc, deadlineAt: '2026-11-12T21:49:57.000Z',
  });
  const snap = store.addSnapshot({
    provider: 'electricitymaps', dataClass: 'real', zone: 'US-CAL-CISO', issuedAt: '2026-11-12T19:49:57.372Z', fetchedAt: '2026-11-12T19:49:58.066Z',
    horizonHours: 6, granularity: 'hourly', emissionFactorType: 'lifecycle', unit: 'gCO2eq/kWh',
    points: [
      { datetime: '2026-11-12T19:00:00.000Z', carbonIntensity: 119 },
      { datetime: '2026-11-12T20:00:00.000Z', carbonIntensity: 117 },
      { datetime: '2026-11-12T21:00:00.000Z', carbonIntensity: 122 },
    ],
    endpoint: '/carbon-intensity/forecast?zone=US-CAL-CISO&horizonHours=6', rawSha256: '7d1d50d0150c',
  });
  const decision = store.addDecision({
    jobId: job.id, snapshotId: snap.id, engineVersion: 'test', status: 'RECOMMENDED', dataMode: 'live', dataClass: 'real',
    riskModel: 'deterministic-no-uncertainty-data', recommendedWindow: REC, immediateWindow: IMM, energyAssumption: ENERGY,
    result: {
      recommendedDecision: { policyId: 'carbonroute_uncertainty', policyName: 'CarbonRoute Uncertainty-Aware', rationale: 'r' },
      evaluatedPolicies: [
        { policyId: 'immediate', policyName: 'Immediate Execution', selectedStartUtc: IMM.startUtc, selectedEndUtc: IMM.endUtc, predictedCarbonIntensity: 119, meetsDeadline: true },
        { policyId: 'carbonroute_uncertainty', policyName: 'CarbonRoute Uncertainty-Aware', selectedStartUtc: REC.startUtc, selectedEndUtc: REC.endUtc, predictedCarbonIntensity: 117, meetsDeadline: true },
      ],
      comparisonSummary: { carbonSavingsVsImmediatePct: 1.7 },
    },
  });
  store.addExecution({
    jobId: job.id, decisionId: decision.id, executionMode: 'simulated-no-workload', scheduledStartUtc: REC.startUtc, scheduledEndUtc: REC.endUtc,
    dispatchedAt: '2026-11-12T19:50:11.673Z', note: 'Simulated', ...(opts.measuredEnergyKwh !== undefined ? { measuredEnergyKwh: opts.measuredEnergyKwh } : {}),
  });
  const recObs = opts.recObs ?? [obs('2026-11-12T20:00:00.000Z', 123)];
  const immObs = opts.immediateObs ?? [obs('2026-11-12T19:00:00.000Z', 131), obs('2026-11-12T20:00:00.000Z', 123)];
  store.addObservationSet({
    jobId: job.id, decisionId: decision.id, window: REC, intervals: ['2026-11-12T20:00:00.000Z'], collectedAt: '2026-11-12T21:26:04.564Z',
    status: 'COMPLETE', statusDetail: 'ok', observations: recObs, missingIntervals: [],
    immediate: { window: IMM, intervals: ['2026-11-12T19:00:00.000Z', '2026-11-12T20:00:00.000Z'], observations: immObs, missingIntervals: [] },
    provider: 'electricitymaps', endpoint: '/carbon-intensity/history?zone=US-CAL-CISO', rawSha256: 'abc',
  });
  return { store, jobId: job.id };
}

describe('Defect 1 regression: time-weighted Immediate window', () => {
  it('uses 124.34 observed / 117.33 forecast for the Immediate window, not 127 / 119', () => {
    const { store, jobId } = demoStore();
    const { windowComparison } = evaluateJob(jobId, store);
    expect(windowComparison.immediate.observedIntensity).toBe(124.34);
    expect(windowComparison.immediate.observedIntensity).not.toBe(127); // old equal-weight value
    expect(windowComparison.immediate.forecastIntensity).toBe(117.33);
    expect(windowComparison.immediate.forecastIntensity).not.toBe(119); // old first-slot value
    expect(windowComparison.immediate.segments.map((s: any) => [s.intervalStart, Math.round(s.overlapMinutes * 100) / 100])).toEqual([
      ['2026-11-12T19:00:00.000Z', 10.04],
      ['2026-11-12T20:00:00.000Z', 49.96],
    ]);
    expect(windowComparison.recommended).toMatchObject({ forecastIntensity: 117, observedIntensity: 123, observedQuality: 'measured' });
    expect(windowComparison.observedDifference).toBe(1.34);
    expect(windowComparison.observedDifferencePct).toBe(1.08);
    expect(windowComparison.forecastDifference).toBe(0.33);
  });

  it('the report uses time-weighted forecasts per policy and keeps the engine value separately', () => {
    const { store, jobId } = demoStore();
    const r = buildReport(jobId, store);
    const imm = r.decision.algorithmComparison.find((p: any) => p.policyId === 'immediate');
    expect(imm).toMatchObject({ forecastIntensityTimeWeighted: 117.33, engineHourlySlotIntensity: 119 });
    expect(r.decision.predictedSavingsVsImmediatePct).toBe(0.28); // (117.33 - 117) / 117.33
    expect(r.decision.engineSlotSavingsVsImmediatePct).toBe(1.7); // recorded value, kept for traceability
  });

  it('an incomplete Immediate window gives no comparison instead of a partial average', () => {
    const { store, jobId } = demoStore({ immediateObs: [obs('2026-11-12T20:00:00.000Z', 123)] });
    const { windowComparison } = evaluateJob(jobId, store);
    expect(windowComparison.available).toBe(false);
    expect(windowComparison.immediate.observedIntensity).toBeNull();
    expect(windowComparison.observedDifference).toBeNull();
    expect(windowComparison.immediate.missing[0]).toEqual({ start: IMM.startUtc, end: '2026-11-12T20:00:00.000Z' });
    expect(windowComparison.basis).toMatch(/Immediate window is not fully observed/);
  });

  it('observations with a different emission-factor type are excluded, not mixed', () => {
    const { store, jobId } = demoStore({ recObs: [obs('2026-11-12T20:00:00.000Z', 90, { factor: 'direct' })] });
    const { intensity } = evaluateJob(jobId, store);
    expect(intensity!.observed.value).toBeNull();
    expect(intensity!.observed.excludedForEmissionFactor).toEqual(['2026-11-12T20:00:00.000Z']);
  });

  it('estimated and measured observations keep their labels in the time-weighted result', () => {
    const { store, jobId } = demoStore({ immediateObs: [obs('2026-11-12T19:00:00.000Z', 131, { estimated: true }), obs('2026-11-12T20:00:00.000Z', 123)] });
    const { windowComparison } = evaluateJob(jobId, store);
    expect(windowComparison.immediate.observedQuality).toBe('mixed');
    expect(windowComparison.recommended.observedQuality).toBe('measured');
  });
});

describe('Defect 2 regression: realized vs estimated emissions', () => {
  it('without recorded energy, realized emissions are unavailable and the assumed-energy figure is labelled an estimate', () => {
    const { store, jobId } = demoStore();
    const r = buildReport(jobId, store);
    expect(r.energy).toMatchObject({ recordedEnergyKwh: null, assumption: { energyKwh: 0.25 } });
    expect(r.emissions.realized).toMatchObject({ available: false, label: 'Realized emissions unavailable' });
    expect(r.emissions.estimated).toMatchObject({ label: 'Estimated emissions (assumed energy)', grams: 30.8, energyKwh: 0.25, intensityQuality: 'measured' });
    expect(r.observedIntensity).toMatchObject({ observedTimeWeighted: 123, observedQuality: 'measured', forecastTimeWeighted: 117 });
    expect((r as any).realized).toBeUndefined();
    expect((r as any).observedComparison).toBeUndefined();

    const html = renderReportHtml(r);
    expect(html).not.toContain('Realized result');
    expect(html).not.toContain('Emissions (assumed energy x observed intensity)');
    expect(html).toContain('Realized emissions unavailable');
    expect(html).toContain('Estimated emissions (assumed energy)');
    expect(html).toContain('estimate, not a realized emission');
    expect(html).toContain('Recorded energy consumption</td><td>Not recorded');
    expect(html).toContain('Comparison with Immediate execution (time-weighted intensity)');
  });

  it('with recorded energy, realized emissions are calculated from it (and the estimate stays separate)', () => {
    const { store, jobId } = demoStore({ measuredEnergyKwh: 0.4 });
    const r = buildReport(jobId, store);
    expect(r.emissions.realized).toMatchObject({ available: true, grams: 49.2, energyKwh: 0.4, energySource: 'recorded' });
    expect(r.emissions.estimated.grams).toBe(30.8);
    expect(renderReportHtml(r)).toContain('Realized emissions (recorded energy)');
  });

  it('assessEmissions never treats an assumption as realized energy', () => {
    const m = { value: 100, quality: 'measured' as const };
    expect(assessEmissions(m, ENERGY).realized.available).toBe(false);
    expect(assessEmissions(m, ENERGY, 0).realized.available).toBe(false);
    expect(assessEmissions(m, ENERGY, NaN).realized.available).toBe(false);
    expect(assessEmissions({ value: null, quality: null }, ENERGY, 1).realized).toMatchObject({ available: false });
    expect(assessEmissions(m, ENERGY, 2).realized).toMatchObject({ available: true, grams: 200 });
  });

  it('windowIntensity on an exact hour matches the single observation', () => {
    const wi = windowIntensity(REC, { points: [{ datetime: '2026-11-12T20:00:00.000Z', carbonIntensity: 117 }], granularityMinutes: 60, emissionFactorType: 'lifecycle' }, [obs('2026-11-12T20:00:00.000Z', 123)]);
    expect([wi.forecast.value, wi.observed.value, wi.observed.quality]).toEqual([117, 123, 'measured']);
  });
});

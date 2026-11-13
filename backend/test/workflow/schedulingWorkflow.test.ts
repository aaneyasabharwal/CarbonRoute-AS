/**
 * End-to-end workflow tests with a fixed clock:
 *   real recorded forecast (DE, issued 2026-11-12T18:58Z) -> decision -> observations -> report.
 *
 * Observation responses for the scheduled window are SYNTHETIC test data (the recorded
 * history fixtures cover the 24 h before the forecast, not the scheduled window); they are
 * built by `historyBody` below and used only to exercise matching and labelling.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElectricityMapsClient } from '../../src/carbon/electricityMaps';
import { ElectricityMapsDataProvider, CarbonService } from '../../src/services/carbonService';
import { SchedulingStore } from '../../src/models/schedulingStore';
import { scheduleWorkflow, collectObservations, evaluateJob, ScheduleInput } from '../../src/services/schedulingWorkflow';
import { buildReport, renderReportHtml } from '../../src/services/reportService';
import { errorMetrics, evaluateForecast, hourlyIntervals } from '../../src/evaluation/forecastEvaluation';
import type { Observation } from '../../src/carbon/types';

const FIX = path.join(__dirname, '..', 'fixtures', 'electricitymaps');
const forecastFixture = fs.readFileSync(path.join(FIX, 'recorded-forecast-DE-24h-hourly.json'), 'utf8');
const NOW = Date.parse('2026-11-12T19:00:12Z'); // just after the recorded forecast was issued
const H = 3600_000;

function fakeClient(bodies: Array<{ status?: number; body: string }>) {
  let i = 0;
  const fetchImpl = vi.fn(async () => {
    const b = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(b.body, { status: b.status ?? 200 });
  });
  return { client: new ElectricityMapsClient({ apiKey: 'test-key', fetchImpl: fetchImpl as any, sleep: async () => {}, now: () => NOW }), fetchImpl };
}

function liveForecastDep(client: ElectricityMapsClient) {
  const provider = new ElectricityMapsDataProvider(undefined, client);
  return (zone: string, horizon: number, mode: 'live' | 'demo') =>
    mode === 'demo' ? CarbonService.getForecast(zone, horizon, 'demo') : provider.getForecast(zone, horizon);
}

let store: SchedulingStore;
beforeEach(() => {
  store = new SchedulingStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-test-wf-')), 'sched.json'));
});

const baseInput = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  name: 'Nightly ETL',
  commandOrImage: 'carbonroute/test-workload:latest',
  isContainerImage: true,
  zone: 'DE',
  durationHours: 2,
  cpu: 2,
  memoryMb: 1024,
  riskTolerance: 0.05,
  deadlineAt: new Date(NOW + 12 * H).toISOString(),
  mode: 'live',
  ...over,
});

async function scheduleLive(over: Partial<ScheduleInput> = {}) {
  const { client, fetchImpl } = fakeClient([{ body: forecastFixture }]);
  const out: any = await scheduleWorkflow(baseInput(over), { now: () => NOW, store, getForecast: liveForecastDep(client) as any });
  return { out, fetchImpl, client };
}

describe('scheduling with a real (recorded) forecast', () => {
  it('recommends a window that meets the deadline, with wall-clock times for every policy', async () => {
    const { out } = await scheduleLive();
    expect(out.status).toBe('RECOMMENDED');
    expect(out.riskModel).toBe('deterministic-no-uncertainty-data');
    const deadline = Date.parse(out.job.deadlineAt);
    for (const p of out.evaluatedPolicies) {
      expect(Date.parse(p.selectedStartUtc)).toBeGreaterThanOrEqual(NOW);
      expect(p.meetsDeadline).toBe(Date.parse(p.selectedEndUtc) <= deadline);
    }
    expect(out.recommendedDecision.meetsDeadline).toBe(true);
    expect(Date.parse(out.recommendedWindow.endUtc)).toBeLessThanOrEqual(deadline);
    // Immediate starts at the arrival time (now), not at the start of the already-begun hour.
    const imm = out.evaluatedPolicies.find((p: any) => p.policyId === 'immediate');
    expect(imm.selectedStartUtc).toBe(new Date(NOW).toISOString());
    // No invented uncertainty on live data.
    expect(out.candidateWindows.every((w: any) => w.stdDev === null && /no forecast uncertainty/.test(w.uncertaintyRange))).toBe(true);
  });

  it('stores the exact forecast snapshot used, with provenance', async () => {
    const { out } = await scheduleLive();
    const snap = store.getSnapshot(out.snapshotId)!;
    const raw = JSON.parse(forecastFixture);
    expect(snap.points.map((p) => p.carbonIntensity)).toEqual(raw.forecast.map((p: any) => p.carbonIntensity));
    expect(snap).toMatchObject({ provider: 'electricitymaps', dataClass: 'real', zone: 'DE', issuedAt: '2026-11-12T18:58:56.219Z', horizonHours: 24 });
    expect(out.provenance).toMatchObject({ provider: 'electricitymaps', issuedAt: snap.issuedAt, uncertaintySource: 'unavailable' });
    const decision = store.getDecision(out.decisionId)!;
    expect(decision).toMatchObject({ status: 'RECOMMENDED', snapshotId: snap.id, dataClass: 'real' });
  });

  it('reports INFEASIBLE without fetching data when even an immediate start misses the deadline', async () => {
    const { out, fetchImpl } = await scheduleLive({ durationHours: 3, deadlineAt: new Date(NOW + 2 * H).toISOString() });
    expect(out.status).toBe('INFEASIBLE');
    expect(out.recommendation).toBeNull();
    expect(out.reason).toMatch(/cannot finish before the deadline/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.getDecision(out.decisionId)!.status).toBe('INFEASIBLE');
  });

  it('flags a deadline beyond the forecast and only evaluates covered windows', async () => {
    const { out } = await scheduleLive({ deadlineAt: new Date(NOW + 40 * H).toISOString() });
    expect(out.timeline.deadlineBeyondForecast).toBe(true);
    expect(Date.parse(out.recommendedWindow.endUtc)).toBeLessThanOrEqual(Date.parse(out.timeline.forecastCoverageEndUtc));
  });

  it('never recommends a window outside [arrival, deadline] across many deadlines and durations', async () => {
    for (const dur of [1, 2, 3, 5, 8]) {
      for (const hrs of [dur, dur + 0.5, dur + 1, 6, 11.75, 23]) {
        if (hrs < dur) continue;
        const { out } = await scheduleLive({ durationHours: dur, deadlineAt: new Date(NOW + hrs * H).toISOString() });
        if (out.status !== 'RECOMMENDED') continue;
        expect(Date.parse(out.recommendedWindow.startUtc)).toBeGreaterThanOrEqual(NOW);
        expect(Date.parse(out.recommendedWindow.endUtc)).toBeLessThanOrEqual(Date.parse(out.job.deadlineAt));
      }
    }
  });

  it('validates inputs instead of silently replacing them', async () => {
    await expect(scheduleLive({ durationHours: 1.5 })).rejects.toMatchObject({ status: 400 });
    await expect(scheduleLive({ durationHours: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(scheduleLive({ riskTolerance: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(scheduleLive({ deadlineAt: 'tomorrow' })).rejects.toMatchObject({ status: 400 });
    await expect(scheduleLive({ deadlineAt: new Date(NOW - H).toISOString() })).rejects.toMatchObject({ status: 400 });
    await expect(scheduleLive({ zone: 'de;drop' })).rejects.toMatchObject({ code: 'INVALID_PARAMETER' });
  });
});

/** SYNTHETIC history body for the given intervals (test data, not provider output). */
function historyBody(intervals: string[], opts: { estimated?: string[]; missing?: string[]; value?: (t: string) => number } = {}) {
  return JSON.stringify({
    zone: 'DE',
    history: intervals
      .filter((t) => !(opts.missing || []).includes(t))
      .map((t) => ({
        zone: 'DE',
        carbonIntensity: opts.value ? opts.value(t) : 300,
        datetime: t,
        isEstimated: (opts.estimated || []).includes(t),
        estimationMethod: (opts.estimated || []).includes(t) ? 'FORECASTS_HIERARCHY' : null,
        emissionFactorType: 'lifecycle',
      })),
  });
}

describe('observations after execution', () => {
  it('is PENDING until the scheduled window has finished, without calling the provider', async () => {
    const { out } = await scheduleLive();
    const { client, fetchImpl } = fakeClient([{ body: '{}' }]);
    const set = await collectObservations(out.job.id, { now: () => NOW, store, client });
    expect(set.status).toBe('PENDING_WINDOW_NOT_FINISHED');
    expect(set.observations).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('matches observations to the forecast, separating measured values from provider estimates', async () => {
    const { out } = await scheduleLive();
    const w = out.recommendedWindow;
    const intervals = hourlyIntervals(w.startUtc, w.endUtc);
    const immIntervals = hourlyIntervals(out.evaluatedPolicies[0].selectedStartUtc, out.evaluatedPolicies[0].selectedEndUtc);
    const all = [...new Set([...immIntervals, ...intervals])];
    const after = Date.parse(w.endUtc) + H;
    const { client } = fakeClient([{ body: historyBody(all, { estimated: [intervals[intervals.length - 1]], value: () => 350 }) }]);

    const set = await collectObservations(out.job.id, { now: () => after, store, client });
    expect(set.status).toBe('COMPLETE');
    expect(set.observations.map((o) => o.quality)).toEqual(intervals.map((_, i) => (i === intervals.length - 1 ? 'provider-estimate' : 'measured')));

    // Changed in task/reporting-corrections: window values are time-weighted and emissions are
    // split into realized (recorded energy only) and estimated (assumed energy).
    const { evaluation, intensity, emissions, windowComparison } = evaluateJob(out.job.id, store);
    expect(evaluation!.measured!.n).toBe(intervals.length - 1);
    expect(evaluation!.providerEstimate!.n).toBe(1);
    const snap = store.getSnapshot(out.snapshotId)!;
    const f0 = snap.points.find((p) => p.datetime === intervals[0])!.carbonIntensity;
    expect(evaluation!.pairs[0]).toMatchObject({ forecast: f0, observed: 350, error: f0 - 350 });
    expect(intensity!.observed.quality).toBe('mixed');
    expect(intensity!.observed.value).toBe(350);
    expect(emissions!.realized).toMatchObject({ available: false, label: 'Realized emissions unavailable' });
    expect(emissions!.estimated).toMatchObject({ label: 'Estimated emissions (assumed energy)', grams: 350 * out.energyAssumption.energyKwh });
    expect(windowComparison).toMatchObject({ available: true, recommended: { observedQuality: 'mixed' } });
    expect(windowComparison.basis).toMatch(/counterfactual/);
  });

  it('PARTIAL coverage: errors only for matched intervals, no realized value, missing listed', async () => {
    const { out } = await scheduleLive();
    const w = out.recommendedWindow;
    const intervals = hourlyIntervals(w.startUtc, w.endUtc);
    const { client } = fakeClient([{ body: historyBody(intervals, { missing: [intervals[0]] }) }]);
    const set = await collectObservations(out.job.id, { now: () => Date.parse(w.endUtc) + H, store, client });
    expect(set.status).toBe('PARTIAL');
    expect(set.missingIntervals).toEqual([intervals[0]]);
    const { evaluation, intensity, emissions } = evaluateJob(out.job.id, store);
    expect(evaluation!.unmatchedIntervals).toEqual([intervals[0]]);
    expect(evaluation!.pairs).toHaveLength(intervals.length - 1);
    expect(intensity!.observed.value).toBeNull();
    expect(intensity!.observed.missing[0].start).toBe(w.startUtc);
    expect(intensity!.observed.reason).toMatch(/whole window is covered/);
    expect(emissions!.estimated.grams).toBeNull();
  });

  it('reports the window as missed after 24 h, without calling the provider', async () => {
    const { out } = await scheduleLive();
    const { client, fetchImpl } = fakeClient([{ body: '{}' }]);
    const set = await collectObservations(out.job.id, { now: () => Date.parse(out.recommendedWindow.startUtc) + 25 * H, store, client });
    expect(set.status).toBe('UNAVAILABLE_WINDOW_MISSED');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(evaluateJob(out.job.id, store).evaluation).toBeNull();
  });

  it('reports a provider failure as unavailable, not as data', async () => {
    const { out } = await scheduleLive();
    const { client } = fakeClient([{ status: 401, body: '{"message":"The provided token is invalid."}' }]);
    const set = await collectObservations(out.job.id, { now: () => Date.parse(out.recommendedWindow.endUtc) + H, store, client });
    expect(set).toMatchObject({ status: 'UNAVAILABLE_PROVIDER_ERROR', errorCode: 'UNAUTHORIZED', observations: [] });
  });

  it('does not compare a synthetic demo forecast with real observations', async () => {
    const out: any = await scheduleWorkflow(baseInput({ mode: 'demo', zone: 'BENCHMARK-RESEARCH' }), { now: () => NOW, store });
    const { client, fetchImpl } = fakeClient([{ body: '{}' }]);
    const set = await collectObservations(out.job.id, { now: () => NOW + 48 * H, store, client });
    expect(set.status).toBe('NOT_APPLICABLE_SYNTHETIC');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('report', () => {
  it('contains provenance, decision, deadline compliance, observations, errors and limitations', async () => {
    const { out } = await scheduleLive();
    store.addExecution({
      jobId: out.job.id,
      decisionId: out.decisionId,
      executionMode: 'simulated-no-workload',
      scheduledStartUtc: out.recommendedWindow.startUtc,
      scheduledEndUtc: out.recommendedWindow.endUtc,
      dispatchedAt: new Date(NOW).toISOString(),
      note: 'Simulated',
    });
    const intervals = hourlyIntervals(out.recommendedWindow.startUtc, out.recommendedWindow.endUtc);
    const { client } = fakeClient([{ body: historyBody(intervals) }]);
    await collectObservations(out.job.id, { now: () => Date.parse(out.recommendedWindow.endUtc) + H, store, client });

    const r = buildReport(out.job.id, store);
    expect(r.dataClass).toBe('real');
    expect(r.dataProvenance).toMatchObject({ provider: 'electricitymaps', forecastIssuedAt: '2026-11-12T18:58:56.219Z' });
    expect(r.decision.deadlineCompliance!.meetsDeadline).toBe(true);
    expect(r.decision.algorithmComparison).toHaveLength(5);
    expect(r.decision.predictedSavingsBasis).toMatch(/not observed/);
    expect(r.observations.status).toBe('COMPLETE');
    expect(r.forecastError!.versusMeasured!.n).toBe(intervals.length);
    expect(r.forecastError!.versusProviderEstimate).toBeNull();
    expect(r.limitations.join(' ')).toMatch(/simulated/i);
    expect(r.energy.recordedEnergyKwh).toBeNull();
    expect(r.emissions.realized).toMatchObject({ available: false, label: 'Realized emissions unavailable' });
    expect(r.emissions.estimated.label).toBe('Estimated emissions (assumed energy)');

    const html = renderReportHtml(r);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Forecast error');
    expect(html).not.toMatch(/<script/i);
  });

  it('a synthetic decision is clearly marked in the report', async () => {
    const out: any = await scheduleWorkflow(baseInput({ mode: 'demo', zone: 'BENCHMARK-RESEARCH' }), { now: () => NOW, store });
    const r = buildReport(out.job.id, store);
    expect(r.dataClass).toBe('synthetic');
    expect(r.limitations[0]).toMatch(/SYNTHETIC DATA/);
    expect(renderReportHtml(r)).toContain('Synthetic data.');
  });

  it('escapes user-provided text in the HTML report', async () => {
    const { out } = await scheduleLive({ name: '<img src=x onerror=alert(1)>' });
    const html = renderReportHtml(buildReport(out.job.id, store));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('evaluation helpers (hand-computed)', () => {
  it('errorMetrics', () => {
    expect(errorMetrics([])).toBeNull();
    expect(errorMetrics([10, -10, 20])).toEqual({ n: 3, mae: 13.33, rmse: 14.14, bias: 6.67, unit: 'gCO2eq/kWh' });
  });

  it('hourlyIntervals covers partial hours', () => {
    expect(hourlyIntervals('2026-11-12T19:00:12Z', '2026-11-12T21:00:12Z')).toEqual([
      '2026-11-12T19:00:00.000Z',
      '2026-11-12T20:00:00.000Z',
      '2026-11-12T21:00:00.000Z',
    ]);
  });

  it('evaluateForecast only pairs intervals with both values', () => {
    const obs = (t: string, v: number, est = false): Observation => ({
      zone: 'DE', datetime: t, granularity: 'hourly', carbonIntensity: v, isEstimated: est, estimationMethod: est ? 'X' : null,
      quality: est ? 'provider-estimate' : 'measured', emissionFactorType: 'lifecycle', providerUpdatedAt: null, fetchedAt: t, provider: 'electricitymaps',
    });
    const ev = evaluateForecast(
      ['a', 'b', 'c'],
      [{ datetime: 'a', carbonIntensity: 100 }, { datetime: 'b', carbonIntensity: 200 }],
      [obs('a', 90), obs('c', 50, true)]
    );
    expect(ev.pairs).toEqual([expect.objectContaining({ datetime: 'a', error: 10 })]);
    expect(ev.unmatchedIntervals).toEqual(['b', 'c']);
    expect(ev.providerEstimate).toBeNull();
  });
});

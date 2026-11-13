/**
 * P8 scheduling correctness: deadline risk must use the exact deadline and arrival instants.
 *
 * Before P8 the workflow floored the deadline to a whole forecast hour and measured a window in the
 * arrival slot from the START of that hour:
 *  - A (over-conservative): a window ending 32 min before the deadline was treated as having zero
 *    slack (50 % miss risk at cv > 0) and was rejected;
 *  - B (unsafe, masked by A): starting at once was measured from the start of the arrival hour, so a
 *    window that really ends 5 min before the deadline would look like it had 65 min of slack.
 *    Fixing A alone would have made B recommend a window whose true risk (~34 %) exceeds tau.
 * The forecast here is a fixed test fixture (descending intensities, so later windows are cleaner).
 */
import { describe, it, expect } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { scheduleWorkflow } from '../../src/services/schedulingWorkflow';
import { SchedulingStore } from '../../src/models/schedulingStore';
import { ElectricityMapsDataProvider } from '../../src/services/carbonService';
import { SchedulerService } from '../../src/services/schedulerService';
import { normalCdf } from '../../src/services/uncertaintyService';

const H = 3600_000;
const START = Date.UTC(2026, 10, 13, 13); // forecast starts 13:00 UTC

function snapshot() {
  return {
    provider: 'electricitymaps',
    dataClass: 'real',
    zone: 'DE',
    issuedAt: new Date(START).toISOString(),
    fetchedAt: new Date(START + 30 * 60_000).toISOString(),
    horizonHours: 24,
    granularity: 'hourly',
    emissionFactorType: 'lifecycle',
    unit: 'gCO2eq/kWh',
    points: Array.from({ length: 24 }, (_, i) => ({ datetime: new Date(START + i * H).toISOString(), carbonIntensity: 400 - 10 * i })),
    endpoint: '/carbon-intensity/forecast?zone=DE',
    rawSha256: 'fixture',
  };
}

async function run(arrivalMin: number, deadlineMin: number, extra: Record<string, unknown> = {}) {
  const store = new SchedulingStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cr-exact-')), 's.json'));
  const provider = new ElectricityMapsDataProvider(undefined, { getForecast: async () => snapshot() } as any);
  const now = START + arrivalMin * 60_000;
  return (await scheduleWorkflow(
    {
      name: 'exact',
      commandOrImage: 'busybox',
      isContainerImage: true,
      zone: 'DE',
      durationHours: 2,
      cpu: 1,
      memoryMb: 128,
      riskTolerance: 0.1,
      runtimeCv: 0.1,
      arrivalAt: new Date(now).toISOString(),
      deadlineAt: new Date(START + deadlineMin * 60_000).toISOString(),
      mode: 'live',
      ...extra,
    },
    { now: () => now, store, getForecast: async (z: string, h: number) => provider.getForecast(z, h) }
  )) as any;
}

describe('deadline risk uses exact instants (P8)', () => {
  it('A: a window that ends 32 min before the deadline is not treated as having zero slack', async () => {
    // Arrival 13:32, deadline 18:32, 2 h job, cv 0.1 (sigma 12 min).
    const r = await run(32, 5 * 60 + 32);
    expect(r.status).toBe('RECOMMENDED');
    expect(r.recommendedWindow).toEqual({ startUtc: '2026-11-13T16:00:00.000Z', endUtc: '2026-11-13T18:00:00.000Z' });
    const cr = r.evaluatedPolicies.find((p: any) => p.policyId === 'carbonroute_uncertainty');
    // P(miss) = 1 - Phi(32 min / 12 min)
    expect(cr.estimatedDeadlineRisk).toBeCloseTo(1 - normalCdf(32 / 12), 6);
    expect(cr.estimatedDeadlineRisk).toBeLessThan(0.01);
  });

  it('B: starting at once is measured from the arrival instant, so a window that really ends 5 min before the deadline is too risky', async () => {
    // Arrival 13:40, deadline 15:45: the only window is 13:40-15:40 (5 min slack, sigma 12 min).
    const r = await run(40, 2 * 60 + 45);
    expect(r.status).toBe('INFEASIBLE_RISK');
    const only = r.candidateWindows[0];
    const expected = 1 - normalCdf(5 / 12); // ~0.34
    expect(only.deadlineRisk).toBeCloseTo(expected, 6);
    expect(only.deadlineRisk).toBeGreaterThan(0.3);
  });

  it('B with enough tolerance: the same window is recommended and its reported risk is the true one', async () => {
    const r = await run(40, 2 * 60 + 45, { riskTolerance: 0.4 });
    expect(r.status).toBe('RECOMMENDED');
    expect(r.recommendedWindow.startUtc).toBe('2026-11-13T13:40:00.000Z');
    const cr = r.evaluatedPolicies.find((p: any) => p.policyId === 'carbonroute_uncertainty');
    expect(cr.estimatedDeadlineRisk).toBeCloseTo(1 - normalCdf(5 / 12), 6);
  });

  it('deterministic runtime (cv 0): a window is feasible exactly when it ends by the deadline instant', async () => {
    const ok = await run(40, 2 * 60 + 41, { runtimeCv: 0 }); // 13:40-15:40 ends 1 min early
    expect(ok.status).toBe('RECOMMENDED');
    const late = await run(40, 2 * 60 + 39, { runtimeCv: 0 }); // would end 1 min late
    expect(late.status).not.toBe('RECOMMENDED');
  });

  it('whole-hour arrival and deadline behave exactly as before (no offset, no fractional slack)', async () => {
    // Arrival 13:00, deadline 21:00 (8 h). 19:00-21:00 ends exactly at the deadline: zero slack, 50 % at
    // cv 0.1, rejected; 18:00-20:00 has 1 h slack (risk ~0) and is the cleanest feasible window.
    const r = await run(0, 8 * 60);
    expect(r.status).toBe('RECOMMENDED');
    expect(r.recommendedWindow.startUtc).toBe('2026-11-13T18:00:00.000Z');
    const last = r.candidateWindows.find((c: any) => c.startUtc === '2026-11-13T19:00:00.000Z');
    expect(last.deadlineRisk).toBeCloseTo(0.5, 6);
  });

  it('rejects an invalid arrival offset', () => {
    const job = { id: 'j', name: 'j', commandOrImage: 'x', isContainerImage: false, durationHours: 1, deadlineHours: 5, arrivalHour: 0, arrivalOffsetHours: 1, cpu: 1, memoryMb: 128, region: 'TST', riskTolerance: 0.1, createdAt: 'x' };
    expect(() => SchedulerService.evaluatePolicies(job as any, [100, 100, 100, 100, 100, 100] as any, {})).toThrow(/arrivalOffsetHours/);
  });
});

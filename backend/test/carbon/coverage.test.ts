/**
 * P3: global data coverage and time-zone handling. Uses the recorded (scrubbed) zone listing
 * fixture and code-built collection records.
 */
import { describe, it, expect } from 'vitest';
import zonesFixture from '../fixtures/electricitymaps/recorded-zones-subset.json';
import { parseZone } from '../../src/carbon/electricityMaps';
import { listingCoverage, observedQuality } from '../../src/carbon/coverage';
import { buildDataset } from '../../src/benchmark/dataset';
import { renderCoverage } from '../../src/scripts/coverageReport';
import { timezoneForZone } from '../../src/carbon/zoneTimezones';
import { scheduleWorkflow } from '../../src/services/schedulingWorkflow';
import { SchedulingStore } from '../../src/models/schedulingStore';
import fs from 'fs';
import os from 'os';
import path from 'path';

const zones = Object.entries(zonesFixture as Record<string, any>).map(([code, z]) => parseZone(code, z));

describe('zone listing coverage', () => {
  it('counts listed capabilities and time-zone mapping without inventing past-range', () => {
    const c = listingCoverage(zones);
    expect(c.zones).toBe(6);
    expect(c.zonesWithAccessList).toBe(6);
    expect(c.listed).toMatchObject({ latest: 6, history: 6, forecast: 6, pastRange: 0 });
    // IN spans several time zones? No: India is a single time zone; all six fixture zones map.
    expect(c.timezone.mapped + c.timezone.unknown).toBe(6);
  });

  it('maps single-zone countries and sub-national zones, and returns null instead of guessing', () => {
    expect(timezoneForZone('DE')).toBe('Europe/Berlin');
    expect(timezoneForZone('US-CAL-CISO')).toBe('America/Los_Angeles');
    expect(timezoneForZone('US-NOT-A-REAL-ZONE')).toBeNull();
  });
});

describe('observed collection quality', () => {
  const H = 3600_000;
  const t = (h: number) => new Date(Date.UTC(2026, 10, 14, h)).toISOString();
  const hist = (zone: string, hours: number[], quality: 'measured' | 'provider-estimate') => ({
    run: 1,
    runAt: t(30),
    zone,
    kind: 'history' as const,
    ok: true,
    data: {
      observations: hours.map((h) => ({ zone, datetime: t(h), granularity: 'hourly', carbonIntensity: 100 + h, isEstimated: quality !== 'measured', estimationMethod: null, quality, emissionFactorType: 'lifecycle', providerUpdatedAt: null, fetchedAt: t(30), provider: 'electricitymaps' })),
      missing: [],
    },
  });

  it('reports realized span, missing hours inside it and the measured share', () => {
    const ds = buildDataset([
      hist('GB', [0, 1, 2, 5], 'measured'), // span 0..5 = 6 hours, 2 missing
      hist('IN-NO', [0, 1], 'provider-estimate'),
      { run: 1, runAt: t(30), zone: 'FR', kind: 'forecast', ok: false, error: { code: 'TIMEOUT' } },
    ]);
    const q = observedQuality(ds);
    expect(q.failedCalls).toBe(1);
    const gb = q.zones.find((z) => z.zone === 'GB')!;
    expect(gb).toMatchObject({ realizedHours: 4, missingHours: 2, measuredShare: 1, realizedSpan: { first: t(0), last: t(5) } });
    expect(q.zones.find((z) => z.zone === 'IN-NO')!.measuredShare).toBe(0);
    const md = renderCoverage(listingCoverage(zones), q);
    expect(md).toContain('LISTED');
    expect(md).toContain('OBSERVED');
    expect(md).toMatch(/not proof of entitlement/);
    void H;
  });
});

describe('time-zone-explicit scheduling input (P3)', () => {
  const store = () => new SchedulingStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-tz-')), 's.json'));
  const base = { name: 'tz', commandOrImage: 'busybox', isContainerImage: true, zone: 'BENCHMARK-RESEARCH', durationHours: 1, cpu: 1, memoryMb: 128, riskTolerance: 0.05, mode: 'demo' as const };

  it('rejects a deadline without a time zone designator instead of reading it in server time', async () => {
    await expect(scheduleWorkflow({ ...base, deadlineAt: '2026-11-14T18:00:00' }, { store: store() })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/with a time zone/),
    });
    await expect(scheduleWorkflow({ ...base, deadlineAt: new Date(Date.now() + 6 * 3600_000).toISOString(), arrivalAt: '2026-11-14T10:00' }, { store: store() })).rejects.toMatchObject({ status: 400 });
  });

  it('accepts UTC and explicit offsets, and they denote the same instant', async () => {
    const now = Date.now();
    const deadline = new Date(Math.ceil((now + 8 * 3600_000) / 3600_000) * 3600_000);
    const utc = deadline.toISOString();
    // Same instant written as +05:30 (e.g. India) local time.
    const local = new Date(deadline.getTime() + 5.5 * 3600_000).toISOString().replace('Z', '').replace(/\.\d{3}$/, '') + '+05:30';
    const a: any = await scheduleWorkflow({ ...base, deadlineAt: utc }, { store: store(), now: () => now });
    const b: any = await scheduleWorkflow({ ...base, deadlineAt: local }, { store: store(), now: () => now });
    expect(Date.parse(a.job.deadlineAt)).toBe(Date.parse(b.job.deadlineAt));
    expect(a.recommendedWindow).toEqual(b.recommendedWindow);
  });
});

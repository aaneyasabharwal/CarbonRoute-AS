/**
 * P11 global scheduler integration. The engine works in UTC on hourly forecast points; the zone's
 * IANA time zone (from the global catalogue) is used only to show local times. These tests use a
 * fixed forecast fixture (not real data) for zones that were outside the old curated time-zone map,
 * an aggregate zone without a single local time, and a daylight-saving change.
 */
import { describe, it, expect } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { scheduleWorkflow } from '../../src/services/schedulingWorkflow';
import { SchedulingStore } from '../../src/models/schedulingStore';
import { ElectricityMapsDataProvider } from '../../src/services/carbonService';

const H = 3600_000;

function snapshot(zone: string, start: number) {
  return {
    provider: 'electricitymaps', dataClass: 'real', zone, issuedAt: new Date(start).toISOString(), fetchedAt: new Date(start + 5 * 60_000).toISOString(),
    horizonHours: 24, granularity: 'hourly', emissionFactorType: 'lifecycle', unit: 'gCO2eq/kWh',
    points: Array.from({ length: 24 }, (_, i) => ({ datetime: new Date(start + i * H).toISOString(), carbonIntensity: 300 + ((i * 37) % 120) })),
    endpoint: `/carbon-intensity/forecast?zone=${zone}`, rawSha256: 'fixture',
  };
}

async function run(zone: string, start: number) {
  const store = new SchedulingStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cr-global-')), 's.json'));
  const provider = new ElectricityMapsDataProvider(undefined, { getForecast: async () => snapshot(zone, start) } as any);
  return (await scheduleWorkflow(
    { name: 'global', commandOrImage: 'busybox', isContainerImage: true, zone, durationHours: 2, cpu: 1, memoryMb: 128, riskTolerance: 0.05, runtimeCv: 0, arrivalAt: new Date(start).toISOString(), deadlineAt: new Date(start + 12 * H).toISOString(), mode: 'live' },
    { now: () => start, store, getForecast: async (z: string, h: number) => provider.getForecast(z, h) }
  )) as any;
}

describe('global zones in the scheduling workflow', () => {
  it('a zone outside the old curated map gets its catalogue time zone; the decision is for that zone only', async () => {
    const r = await run('US-TEN-TVA', Date.UTC(2026, 10, 14, 6));
    expect(r.status).toBe('RECOMMENDED');
    expect(r.timeline.timezone).toBe('America/Chicago');
    expect(r.provenance.zone).toBe('US-TEN-TVA'); // never another region
    const ke = await run('KE', Date.UTC(2026, 10, 14, 6));
    expect(ke.timeline.timezone).toBe('Africa/Nairobi');
    expect(ke.provenance.zone).toBe('KE');
  });

  it('an aggregate spanning several time zones has no local time zone (UTC is shown), not a guessed one', async () => {
    const r = await run('US', Date.UTC(2026, 10, 14, 6));
    expect(r.timeline.timezone).toBeNull();
    expect(r.timeline.note).toMatch(/UTC/);
  });

  it('across a daylight-saving change windows stay exactly one UTC hour apart; local labels repeat 01:00', async () => {
    // US Pacific DST ends 2026-11-01 09:00 UTC (02:00 PDT -> 01:00 PST).
    const start = Date.UTC(2026, 10, 1, 6);
    const r = await run('US-CAL-CISO', start);
    expect(r.timeline.timezone).toBe('America/Los_Angeles');
    const starts = r.candidateWindows.map((c: any) => Date.parse(c.startUtc));
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBe(H);
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false });
    const local = starts.map((t: number) => fmt.format(t));
    expect(local.filter((l: string) => l === '01:00')).toHaveLength(2); // 08:00Z = 01:00 PDT, 09:00Z = 01:00 PST
    // Every window ends by the deadline in UTC, whatever the local clock does.
    for (const c of r.candidateWindows) expect(Date.parse(c.endUtc)).toBeLessThanOrEqual(start + 12 * H);
  });
});

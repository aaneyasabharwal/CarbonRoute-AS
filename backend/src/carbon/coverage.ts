/**
 * Global data coverage (P3): what this API key can read for each zone, which zones have a
 * reliable local time zone, and the observed quality of collected data per zone.
 *
 * Two different kinds of evidence are kept apart:
 *  - "listed": capabilities from the provider's zone listing (`access`). A listing is not
 *    proof: past-range, for example, was refused (401) when probed on 2026-11-12.
 *  - "observed": what was actually returned during collection (counts, gaps, measured share).
 */
import type { ZoneInfo } from './types';
import type { CollectedDataset } from '../benchmark/dataset';

const HOUR = 3600_000;

export interface ListingCoverage {
  zones: number;
  zonesWithAccessList: number;
  listed: { latest: number; history: number; forecast: number; pastRange: number; powerBreakdown: number };
  timezone: { mapped: number; unknown: number; unknownExamples: string[] };
  tiers: Record<string, number>;
}

export function listingCoverage(zones: ZoneInfo[]): ListingCoverage {
  const listed = { latest: 0, history: 0, forecast: 0, pastRange: 0, powerBreakdown: 0 };
  const tiers: Record<string, number> = {};
  let withAccess = 0;
  const unknown: string[] = [];
  for (const z of zones) {
    if (z.capabilities) {
      withAccess++;
      for (const k of Object.keys(listed) as (keyof typeof listed)[]) if (z.capabilities[k]) listed[k]++;
    }
    tiers[z.tier || 'unknown'] = (tiers[z.tier || 'unknown'] ?? 0) + 1;
    if (!z.timezone) unknown.push(z.zone);
  }
  return {
    zones: zones.length,
    zonesWithAccessList: withAccess,
    listed,
    timezone: { mapped: zones.length - unknown.length, unknown: unknown.length, unknownExamples: unknown.slice(0, 15) },
    tiers,
  };
}

export interface ObservedZoneQuality {
  zone: string;
  forecastSnapshots: number;
  forecastPointsMin: number | null;
  forecastPointsMax: number | null;
  realizedHours: number;
  realizedSpan: { first: string; last: string } | null;
  /** Hours inside the realized span with no value at all. */
  missingHours: number;
  measuredShare: number | null;
}

export function observedQuality(dataset: CollectedDataset): { zones: ObservedZoneQuality[]; failedCalls: number; records: number } {
  const zones = Object.values(dataset.zones)
    .sort((a, b) => a.zone.localeCompare(b.zone))
    .map((z) => {
      const hourly = z.realized.filter((r) => r.intervalMinutes === 60);
      const times = hourly.map((r) => Date.parse(r.datetime));
      const first = times.length ? Math.min(...times) : null;
      const last = times.length ? Math.max(...times) : null;
      const expected = first === null || last === null ? 0 : Math.round((last - first) / HOUR) + 1;
      const counts = z.snapshots.map((s) => s.points.length);
      return {
        zone: z.zone,
        forecastSnapshots: z.snapshots.length,
        forecastPointsMin: counts.length ? Math.min(...counts) : null,
        forecastPointsMax: counts.length ? Math.max(...counts) : null,
        realizedHours: hourly.length,
        realizedSpan: first === null || last === null ? null : { first: new Date(first).toISOString(), last: new Date(last).toISOString() },
        missingHours: Math.max(0, expected - new Set(times).size),
        measuredShare: hourly.length ? Math.round((hourly.filter((r) => r.quality === 'measured').length / hourly.length) * 1000) / 1000 : null,
      };
    });
  return { zones, failedCalls: dataset.failedRecords, records: dataset.records };
}

/**
 * Global data coverage report (P3).
 *
 *   npm run coverage -- --data <collection dir> [--zones-file <saved /zones JSON>] [--live]
 *
 * --zones-file reads a saved zone listing (no API call). --live fetches the listing through
 * the project's client (1 call, cached 24 h, counted against the call budget). Without
 * either, only the collected-data section is produced. Prints Markdown; contains no secrets.
 */
import fs from 'fs';
import path from 'path';
import { listingCoverage, observedQuality } from '../carbon/coverage';
import { loadCollectedDataset } from '../benchmark/dataset';
import { parseZone } from '../carbon/electricityMaps';
import type { ZoneInfo } from '../carbon/types';

export function renderCoverage(listing: ReturnType<typeof listingCoverage> | null, observed: ReturnType<typeof observedQuality> | null): string {
  const out: string[] = ['# CarbonRoute global data coverage', ''];
  if (listing) {
    out.push('## Zone listing (capabilities LISTED by the provider for this key)', '');
    out.push(`- Zones: ${listing.zones} (${listing.zonesWithAccessList} with an access list)`);
    out.push(`- Listed: latest ${listing.listed.latest}, history ${listing.listed.history}, forecast ${listing.listed.forecast}, past-range ${listing.listed.pastRange}, power breakdown ${listing.listed.powerBreakdown}`);
    out.push(`- Local time zone known: ${listing.timezone.mapped}; unknown (shown in UTC): ${listing.timezone.unknown}${listing.timezone.unknownExamples.length ? ` (e.g. ${listing.timezone.unknownExamples.join(', ')})` : ''}`);
    out.push(`- Tiers: ${Object.entries(listing.tiers).map(([t, n]) => `${t} ${n}`).join(', ')}`, '');
  }
  if (observed) {
    out.push('## Collected data (OBSERVED)', '');
    out.push(`Records ${observed.records}; failed calls ${observed.failedCalls}.`, '');
    out.push('| Zone | Forecast snapshots | Points per forecast | Realized hours | Missing hours in span | Measured share |', '|---|---|---|---|---|---|');
    for (const z of observed.zones) {
      out.push(`| ${z.zone} | ${z.forecastSnapshots} | ${z.forecastPointsMin ?? 'n/a'}–${z.forecastPointsMax ?? 'n/a'} | ${z.realizedHours} | ${z.missingHours} | ${z.measuredShare ?? 'n/a'} |`);
    }
    out.push('');
  }
  out.push('Listed capabilities are not proof of entitlement (past-range is listed for no zone and was refused when probed on 2026-11-12). Provider estimates are not measurements.', '');
  return out.join('\n');
}

if (require.main === module) {
  const arg = (n: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  (async () => {
    let zones: ZoneInfo[] | null = null;
    const file = arg('zones-file');
    if (file) {
      const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
      zones = Object.entries(raw as Record<string, any>).map(([code, z]) => parseZone(code, z));
    } else if (process.argv.includes('--live')) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      zones = await require('../carbon/electricityMaps').electricityMaps.getZones();
    }
    const data = arg('data');
    console.log(renderCoverage(zones ? listingCoverage(zones) : null, data ? observedQuality(loadCollectedDataset(path.resolve(data))) : null));
  })().catch((err) => {
    console.log(`Coverage report failed: ${err?.message || err}`);
    process.exit(1);
  });
}

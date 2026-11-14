/**
 * Global electricity-grid zone catalogue (P11).
 *
 * Every zone in the Electricity Maps public zone list (351 on 2026-11-14), with country, UN M49
 * area, IANA time zone and, kept strictly apart, what is known about data availability:
 *  - providerListed: what the provider's listing claimed for the project's trial key (not proof);
 *  - verifiedLive:   live data actually read with the project key (with the evidence);
 *  - syntheticDemo:  a CarbonRoute synthetic profile exists (never real data).
 * The data is generated (zoneCatalogue.generated.ts) from versioned sources; see docs/GLOBAL_ZONES.md.
 */
import { CATALOGUE_META, CATALOGUE_ZONES } from './zoneCatalogue.generated';

export interface CatalogueZone {
  zone: string;
  name: string;
  zoneName: string;
  countryCode: string;
  countryName: string | null;
  continent: string | null;
  area: string | null;
  timezone: string | null;
  timezoneSource: string | null;
  parentZone: string | null;
  subZones: string[];
  aggregate: boolean;
  tier: string | null;
  commerciallyAvailable: boolean;
  providerListed: { latest: boolean; history: boolean; forecast: boolean };
  verifiedLive: { latest: boolean; history: boolean; forecast: boolean; evidence: string } | null;
  syntheticDemo: boolean;
  flags: string[];
}

export interface CatalogueMeta {
  version: string;
  zones: number;
  sources: Record<string, string>;
  counts: Record<string, any>;
}

const byZone = new Map(CATALOGUE_ZONES.map((z) => [z.zone, z]));

export function catalogueZones(): CatalogueZone[] {
  return CATALOGUE_ZONES;
}

export function catalogueMeta(): CatalogueMeta {
  return CATALOGUE_META;
}

export function catalogueZone(zone: string): CatalogueZone | undefined {
  return byZone.get(zone);
}

/** IANA time zone of a catalogue zone, or null when it could not be established (never guessed). */
export function catalogueTimezone(zone: string): string | null {
  return byZone.get(zone)?.timezone ?? null;
}

/**
 * Availability of a zone in this deployment, per data mode, with the reason when it is unavailable.
 * `liveConfigured` is whether this server has a provider key.
 */
export function zoneAvailability(zone: string, liveConfigured: boolean) {
  const z = byZone.get(zone);
  if (!z) return { inCatalogue: false, live: false, demo: false, reason: `Zone ${zone} is not in the zone catalogue.` };
  const live = liveConfigured && z.providerListed.forecast;
  return {
    inCatalogue: true,
    live,
    demo: z.syntheticDemo,
    reason: !liveConfigured
      ? 'Live data is not configured on this server (no provider key).'
      : !z.providerListed.forecast
        ? 'The provider does not list a carbon-intensity forecast for this zone.'
        : null,
  };
}

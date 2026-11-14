#!/usr/bin/env node
/**
 * Builds the global electricity-grid zone catalogue (P11) from versioned source files in
 * data/zones/sources/ (no network access, no API key, no provider quota):
 *
 *   electricitymaps-zones-2026-11-14.json          GET https://api.electricitymap.org/v3/zones (public, no key)
 *   electricitymaps-contrib-zone-fields-3baa27a.json timezone + region per zone from the provider's
 *                                                    open-source zone configuration (factual fields only)
 *   iana-zone.tab, iana-backward                    IANA time zone database (public domain)
 *   iso3166-m49-regions.json                        UN M49 regions per ISO country (lukes/ISO-3166-
 *                                                    Countries-with-Regional-Codes, CC BY-SA 4.0)
 *   electricitymaps-trial-key-listing-2026-11-13.json what the provider LISTED for the trial key
 *
 * Verified live coverage and synthetic-demo coverage are stated below with their evidence.
 * Output: backend/src/carbon/zoneCatalogue.generated.ts (committed; regenerate with
 *   node scripts/zones/build-zone-catalogue.mjs).
 * Nothing is invented: a value that cannot be established is null and flagged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (f) => path.join(root, 'data', 'zones', 'sources', f);
const readJson = (f) => JSON.parse(fs.readFileSync(src(f), 'utf8'));

const providerZones = readJson('electricitymaps-zones-2026-11-14.json');
const contrib = readJson('electricitymaps-contrib-zone-fields-3baa27a.json');
const listing = readJson('electricitymaps-trial-key-listing-2026-11-13.json');
const m49 = readJson('iso3166-m49-regions.json');

// IANA: canonical names, aliases, and the zones listed per country.
const aliases = new Map();
// Line endings may be CRLF on Windows checkouts.
for (const line of fs.readFileSync(src('iana-backward'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^Link\s+(\S+)\s+(\S+)/);
  if (m) aliases.set(m[2], m[1]);
}
const tzByCountry = new Map();
const canonicalTz = new Set();
for (const line of fs.readFileSync(src('iana-zone.tab'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [cc, , tz] = line.split('\t');
  canonicalTz.add(tz);
  if (!tzByCountry.has(cc)) tzByCountry.set(cc, []);
  tzByCountry.get(cc).push(tz);
}
// Only legacy names are mapped; a name listed in zone.tab (e.g. Europe/Oslo) is kept, even though
// recent tzdata links it to another zone with identical rules since 1970.
const canonical = (tz) => {
  if (canonicalTz.has(tz)) return tz;
  let t = tz;
  for (let i = 0; i < 5 && aliases.has(t); i++) t = aliases.get(t);
  return t;
};

const countries = new Map(m49.map((c) => [c['alpha-2'], c]));

/**
 * Zones whose live carbon-intensity data was actually read with the project key, with evidence.
 * Probe log 2026-11-12 (latest, 24 h history and 24/72 h forecast all HTTP 200) and the research
 * collector (forecast and history every hour since 2026-11-13 13:32 UTC).
 */
const VERIFIED = {
  DE: 'probe 2026-11-12 and research collector 2026-11-13/14',
  FR: 'research collector 2026-11-13/14',
  GB: 'probe 2026-11-12 and research collector 2026-11-13/14',
  'IN-NO': 'probe 2026-11-12 and research collector 2026-11-13/14',
  'US-CAL-CISO': 'probe 2026-11-12 and research collector 2026-11-13/14',
  IN: 'probe 2026-11-12',
  'IN-SO': 'probe 2026-11-12',
};
/** Zones with a synthetic demo profile (backend/src/services/carbonService.ts REGIONAL_PROFILES). */
const DEMO = new Set(['US-CAL-CISO', 'US-TEX-ERCO', 'DE', 'IN-NO']);

const entries = [];
const flags = [];
for (const [zone, z] of Object.entries(providerZones).sort(([a], [b]) => a.localeCompare(b))) {
  const country = countries.get(z.countryCode);
  const cfg = contrib.zones[zone] || {};
  // Time zone: the provider's per-zone configuration, canonicalised with the IANA alias list and
  // checked against IANA zone.tab for the country.
  let timezone = null;
  let timezoneSource = null;
  const tzFlags = [];
  if (cfg.timezone) {
    const c = canonical(cfg.timezone);
    if (canonicalTz.has(c) || c === 'UTC' || c.startsWith('Etc/')) {
      timezone = c;
      timezoneSource = cfg.timezone === c ? 'electricitymaps-contrib' : `electricitymaps-contrib (${cfg.timezone} -> ${c}, IANA backward)`;
    } else tzFlags.push(`configured time zone ${cfg.timezone} is not in IANA zone.tab`);
  } else tzFlags.push('no time zone in the provider configuration');
  const countryTz = tzByCountry.get(z.countryCode) || [];
  if (timezone && countryTz.length && !countryTz.includes(timezone)) {
    if (countryTz.length === 1) {
      // The provider configuration names another country's zone (e.g. BA -> Asia/Bahrain); the
      // country has exactly one IANA zone, which is authoritative. The correction is recorded.
      tzFlags.push(`provider configuration says ${timezone}; corrected to ${countryTz[0]}, the only IANA zone for ${z.countryCode}`);
      timezoneSource = `IANA zone.tab (single zone for ${z.countryCode}; provider configuration said ${timezone})`;
      timezone = countryTz[0];
    } else {
      tzFlags.push(`provider configuration says ${timezone}, which is not an IANA zone of ${z.countryCode}; left unresolved`);
      timezone = null;
      timezoneSource = null;
    }
  }
  if (timezone && z.subZoneKeys.length > 0 && countryTz.length > 1) {
    // An aggregate of several sub-zones in a country with several IANA zones has no single local time.
    tzFlags.push(`aggregate of ${z.subZoneKeys.length} zones spanning several time zones (provider configuration says ${timezone}); left unresolved, shown in UTC`);
    timezone = null;
    timezoneSource = null;
  }
  const m49Area = country ? country['intermediate-region'] || country['sub-region'] || country.region : null;
  const area = m49Area || null;
  const continent = (country && country.region) || cfg.region || null;
  if (!country) tzFlags.push(`country code ${z.countryCode} not in ISO 3166 / UN M49 (continent from provider region "${cfg.region}")`);
  else if (!country.region) tzFlags.push(`no UN M49 region for ${z.countryCode} in the dataset (continent from provider region "${cfg.region}")`);
  const listed = listing.zones[zone] || { latest: false, history: false, forecast: false };
  const entry = {
    zone,
    name: z.displayName || z.zoneName,
    zoneName: z.zoneName,
    countryCode: z.countryCode,
    countryName: z.countryName || country?.name || null,
    continent,
    area: area || cfg.region || null,
    timezone,
    timezoneSource,
    parentZone: z.zoneParentKey,
    subZones: z.subZoneKeys,
    aggregate: z.subZoneKeys.length > 0,
    tier: z.tier,
    commerciallyAvailable: z.isCommerciallyAvailable,
    providerListed: { latest: !!listed.latest, history: !!listed.history, forecast: !!listed.forecast },
    verifiedLive: VERIFIED[zone] ? { latest: true, history: true, forecast: true, evidence: VERIFIED[zone] } : null,
    syntheticDemo: DEMO.has(zone),
    flags: tzFlags,
  };
  if (tzFlags.length) flags.push(`${zone}: ${tzFlags.join('; ')}`);
  entries.push(entry);
}

for (const z of Object.keys(VERIFIED)) if (!providerZones[z]) throw new Error(`verified zone ${z} missing from the catalogue`);
for (const z of DEMO) if (!providerZones[z]) throw new Error(`demo zone ${z} missing from the catalogue`);

const meta = {
  version: '2026-11-14',
  zones: entries.length,
  sources: {
    zones: 'Electricity Maps public zone list, GET https://api.electricitymap.org/v3/zones (no key), retrieved 2026-11-14',
    timezones: `electricitymaps-contrib config/zones/*.yaml @ ${contrib.commit} (AGPL-3.0 repository; factual timezone/region fields only), canonicalised and checked with the IANA tz database (public domain)`,
    areas: 'UN M49 regions via lukes/ISO-3166-Countries-with-Regional-Codes (CC BY-SA 4.0)',
    providerListed: 'Electricity Maps zone listing with the project trial key, 2026-11-13 (a listing is not proof of access)',
    verifiedLive: 'Read with the project key: probe 2026-11-12 and the research collector 2026-11-13/14',
    syntheticDemo: 'CarbonRoute synthetic demo profiles (not real data)',
  },
  counts: {
    zones: entries.length,
    countries: new Set(entries.map((e) => e.countryCode)).size,
    aggregates: entries.filter((e) => e.aggregate).length,
    withTimezone: entries.filter((e) => e.timezone).length,
    flagged: entries.filter((e) => e.flags.length).length,
    providerListedForecast: entries.filter((e) => e.providerListed.forecast).length,
    providerListedHistory: entries.filter((e) => e.providerListed.history).length,
    providerListedLatest: entries.filter((e) => e.providerListed.latest).length,
    verifiedLive: entries.filter((e) => e.verifiedLive).length,
    syntheticDemo: entries.filter((e) => e.syntheticDemo).length,
    byContinent: Object.fromEntries(
      [...new Set(entries.map((e) => e.continent))].sort().map((c) => [c, entries.filter((e) => e.continent === c).length])
    ),
  },
};

const out = `/* eslint-disable */
// GENERATED by scripts/zones/build-zone-catalogue.mjs from data/zones/sources. Do not edit by hand.
// Sources and licences: docs/GLOBAL_ZONES.md.
import type { CatalogueZone, CatalogueMeta } from './zoneCatalogue';

export const CATALOGUE_META: CatalogueMeta = ${JSON.stringify(meta, null, 2)};

export const CATALOGUE_ZONES: CatalogueZone[] = ${JSON.stringify(entries)};
`;
fs.writeFileSync(path.join(root, 'backend', 'src', 'carbon', 'zoneCatalogue.generated.ts'), out);
console.log(JSON.stringify(meta.counts, null, 1));
if (flags.length) console.log(`\n${flags.length} flagged:\n` + flags.join('\n'));

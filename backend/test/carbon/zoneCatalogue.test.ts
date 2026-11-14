/**
 * P11 global zone catalogue: every zone in the provider's public list, no arbitrary limit, honest
 * availability levels, and no silent substitution of one region for another.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { catalogueZones, catalogueMeta, catalogueZone, zoneAvailability } from '../../src/carbon/zoneCatalogue';
import { timezoneForZone } from '../../src/carbon/zoneTimezones';
import { CarbonService } from '../../src/services/carbonService';

const providerList = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'zones', 'sources', 'electricitymaps-zones-2026-11-14.json'), 'utf8')
);

describe('zone catalogue contents', () => {
  it('contains every zone of the provider list, once, with no limit', () => {
    const zones = catalogueZones().map((z) => z.zone);
    expect(zones.length).toBe(Object.keys(providerList).length);
    expect(zones.length).toBe(351);
    expect(new Set(zones).size).toBe(zones.length);
    expect([...zones].sort()).toEqual(Object.keys(providerList).sort());
    expect(catalogueMeta().counts.zones).toBe(351);
  });

  it('covers every inhabited continent', () => {
    const continents = new Set(catalogueZones().map((z) => z.continent));
    for (const c of ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania']) expect(continents.has(c)).toBe(true);
    expect(catalogueZones().every((z) => z.continent)).toBe(true);
    const areas = new Set(catalogueZones().map((z) => z.area));
    for (const a of ['Northern America', 'Central America', 'South America', 'Western Asia', 'Southern Asia', 'Sub-Saharan Africa' /* M49 sub-region */]) {
      expect([...areas].some((x) => x === a || (a === 'Sub-Saharan Africa' && /Africa/.test(String(x))))).toBe(true);
    }
  });

  it('time zones are IANA names or null with a reason; never guessed', () => {
    for (const z of catalogueZones()) {
      if (z.timezone) {
        expect(() => new Intl.DateTimeFormat('en', { timeZone: z.timezone! })).not.toThrow();
        expect(z.timezoneSource).toBeTruthy();
      } else {
        expect(z.flags.join(' ')).toMatch(/unresolved/);
      }
    }
    expect(catalogueZone('US')!.timezone).toBeNull(); // aggregate spanning several time zones
    expect(catalogueZone('BA')!.timezone).toBe('Europe/Sarajevo'); // provider configuration said Asia/Bahrain
    expect(catalogueZone('IN-NO')!.timezone).toBe('Asia/Kolkata');
    expect(catalogueZone('US-TEN-TVA')!.timezone).toBe('America/Chicago'); // was unresolved before P11
    expect(timezoneForZone('US-TEN-TVA')).toBe('America/Chicago');
    expect(timezoneForZone('DE')).toBe('Europe/Berlin');
  });

  it('keeps provider-listed, verified-live and synthetic-demo availability apart', () => {
    const verified = catalogueZones().filter((z) => z.verifiedLive).map((z) => z.zone).sort();
    expect(verified).toEqual(['DE', 'FR', 'GB', 'IN', 'IN-NO', 'IN-SO', 'US-CAL-CISO']);
    expect(catalogueZones().filter((z) => z.syntheticDemo).map((z) => z.zone).sort()).toEqual(['DE', 'IN-NO', 'US-CAL-CISO', 'US-TEX-ERCO']);
    expect(catalogueZone('KE')!.verifiedLive).toBeNull(); // listed by the provider, never read
    expect(zoneAvailability('KE', false)).toMatchObject({ inCatalogue: true, live: false, demo: false });
    expect(zoneAvailability('XX-NOPE', true).inCatalogue).toBe(false);
  });
});

describe('no silent region substitution (P11)', () => {
  it('demo data for a zone without a synthetic profile is refused, not replaced by another region', async () => {
    await expect(CarbonService.getForecast('KE', 24, 'demo')).rejects.toThrow(/no synthetic demo profile/i);
    const de = await CarbonService.getForecast('DE', 24, 'demo');
    expect(de.region).toBe('DE');
  });

  it('the API says why (422) and the public catalogue endpoint lists every zone', async () => {
    const { default: app } = await import('../../src/app');
    const r = await request(app).get('/api/carbon/forecast?region=KE&mode=demo');
    expect(r.status).toBe(422); // the API's status for invalid parameters
    expect(r.body.message).toMatch(/no synthetic demo profile/i);
    const c = await request(app).get('/api/carbon/catalogue');
    expect(c.status).toBe(200);
    expect(c.body.data.zones).toHaveLength(351);
    expect(c.body.data.meta.counts.verifiedLive).toBe(7);
    expect(typeof c.body.data.liveConfigured).toBe('boolean');
  });
});

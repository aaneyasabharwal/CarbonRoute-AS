/**
 * P11 global zone selector: every catalogue zone is selectable (no limit, no silent truncation),
 * search and filters work across the complete list, and availability is stated honestly.
 * The catalogue below is hand-written test data in the API's shape (351 generated zones).
 */
import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ZoneSelector, zoneUsability, BENCHMARK_ZONE } from '../../src/components/ZoneSelector';
import type { CatalogueZone, ZoneCatalogue } from '../../src/types';

const zone = (z: Partial<CatalogueZone> & { zone: string }): CatalogueZone => ({
  name: z.zone, zoneName: z.zone, countryCode: z.zone.slice(0, 2), countryName: null, continent: 'Europe', area: 'Western Europe',
  timezone: 'Europe/Berlin', timezoneSource: 'test', parentZone: null, subZones: [], aggregate: false, tier: 'TIER_A',
  commerciallyAvailable: true, providerListed: { latest: true, history: true, forecast: true }, verifiedLive: null, syntheticDemo: false, flags: [], ...z,
});
const named = [
  zone({ zone: 'DE', name: 'Germany', countryName: 'Germany', syntheticDemo: true, verifiedLive: { latest: true, history: true, forecast: true, evidence: 'probe' } }),
  zone({ zone: 'KE', name: 'Kenya', countryName: 'Kenya', continent: 'Africa', area: 'Eastern Africa', timezone: 'Africa/Nairobi' }),
  zone({ zone: 'BR-CS', name: 'Central Brazil', countryName: 'Brazil', continent: 'Americas', area: 'South America', timezone: 'America/Sao_Paulo' }),
  zone({ zone: 'IN-NO', name: 'Northern India', countryName: 'India', continent: 'Asia', area: 'Southern Asia', timezone: 'Asia/Kolkata', syntheticDemo: true }),
  zone({ zone: 'AU-NSW', name: 'New South Wales', countryName: 'Australia', continent: 'Oceania', area: 'Australia and New Zealand', timezone: 'Australia/Sydney' }),
];
const filler = Array.from({ length: 351 - named.length }, (_, i) => zone({ zone: `ZZ-${String(i).padStart(3, '0')}`, name: `Test zone ${i}`, continent: ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'][i % 5] }));
const catalogue = (liveConfigured = false): ZoneCatalogue => ({ meta: { version: '2026-11-14', zones: 351, sources: {}, counts: {} }, liveConfigured, zones: [...named, ...filler] });

function Harness({ mode = 'demo' as 'live' | 'demo', cat = catalogue(), initial = 'DE', signedIn = false }) {
  const [v, setV] = useState(initial);
  return <ZoneSelector value={v} onChange={setV} mode={mode} catalogue={cat} error={null} signedIn={signedIn} />;
}
const options = () => within(screen.getByRole('combobox', { name: 'Target Grid Region' })).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);

describe('ZoneSelector', () => {
  it('offers every one of the 351 zones (plus the synthetic benchmark in demo mode); nothing is truncated', () => {
    render(<Harness />);
    const values = options();
    expect(values.filter((v) => v !== BENCHMARK_ZONE)).toHaveLength(351);
    expect(values).toContain(BENCHMARK_ZONE);
    expect(screen.getByTestId('zone-count')).toHaveTextContent('Showing 351 of 351 zones');
  });

  it('searches by country, continent, zone id and area', () => {
    render(<Harness />);
    const search = screen.getByLabelText('Search grid zones');
    fireEvent.change(search, { target: { value: 'brazil' } });
    expect(options()).toContain('BR-CS');
    expect(options()).not.toContain('KE');
    fireEvent.change(search, { target: { value: 'ke' } });
    expect(options()).toContain('KE');
    fireEvent.change(search, { target: { value: 'southern asia' } });
    expect(options()).toContain('IN-NO');
    fireEvent.change(search, { target: { value: 'oceania' } });
    expect(options()).toContain('AU-NSW');
    fireEvent.change(search, { target: { value: 'no-such-zone-xyz' } });
    expect(screen.getByTestId('zone-count')).toHaveTextContent('Showing 0 of 351 zones');
    expect(options()).toContain('DE'); // the current selection is never dropped from the control
  });

  it('filters by continent and availability, grouped by continent and area', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Filter by continent'), { target: { value: 'Americas' } });
    expect(options()).toContain('BR-CS');
    expect(options()).not.toContain('KE');
    expect(screen.getByRole('group', { name: 'Americas · South America' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by continent'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Filter by availability'), { target: { value: 'demo' } });
    expect(options().filter((v) => v !== BENCHMARK_ZONE).sort()).toEqual(['DE', 'IN-NO']);
    fireEvent.change(screen.getByLabelText('Filter by availability'), { target: { value: 'verified' } });
    expect(options().filter((v) => v !== BENCHMARK_ZONE)).toEqual(['DE']);
  });

  it('a zone without a demo profile stays selected and says why demo scheduling is unavailable', () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Target Grid Region' }), { target: { value: 'KE' } });
    expect((screen.getByRole('combobox', { name: 'Target Grid Region' }) as HTMLSelectElement).value).toBe('KE');
    const panel = screen.getByTestId('zone-availability');
    expect(panel).toHaveTextContent('Kenya');
    expect(panel).toHaveTextContent('Africa/Nairobi');
    expect(panel).toHaveTextContent('Live data not verified for this zone');
    expect(screen.getByTestId('zone-usable')).toHaveTextContent(/No synthetic demo profile exists for KE/);
  });

  it('usability rules: demo profile, live configuration, sign-in, benchmark', () => {
    const cat = catalogue(false);
    expect(zoneUsability('DE', 'demo', cat, false).usable).toBe(true);
    expect(zoneUsability('KE', 'demo', cat, true).usable).toBe(false);
    expect(zoneUsability('DE', 'live', cat, true).reason).toMatch(/not configured on this server/);
    expect(zoneUsability('KE', 'live', catalogue(true), false).reason).toMatch(/sign-in/);
    expect(zoneUsability('KE', 'live', catalogue(true), true).usable).toBe(true);
    expect(zoneUsability(BENCHMARK_ZONE, 'live', cat, true).usable).toBe(false);
    expect(zoneUsability('XX-NOPE', 'demo', cat, true).reason).toMatch(/not in the zone catalogue/);
  });
});

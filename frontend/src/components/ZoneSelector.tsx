/**
 * Global grid-zone selector (P11). Every zone of the catalogue is selectable (351 on 2026-11-14,
 * no limit and no silent truncation): search by zone id, name, country, continent or area, filter
 * by continent and availability, grouped by continent and area. The panel under the list keeps the
 * evidence levels apart: in the catalogue, listed by the provider for the trial key (not proof),
 * verified live with the project key, synthetic demo profile, and whether the selected data mode
 * can actually use the zone on this server (with the reason when it cannot).
 */
import React, { useMemo, useState } from 'react';
import type { CatalogueZone, ZoneCatalogue } from '../types';

export const BENCHMARK_ZONE = 'BENCHMARK-RESEARCH';

export interface ZoneUsability {
  usable: boolean;
  reason: string | null;
  /** P13: demo data for a zone without its own profile uses the generic synthetic trace. */
  generic?: boolean;
}

/** Whether a zone can be scheduled in a data mode on this server, and why not. */
export function zoneUsability(
  zone: string,
  mode: 'live' | 'demo',
  catalogue: ZoneCatalogue | null,
  signedIn: boolean
): ZoneUsability {
  if (zone === BENCHMARK_ZONE) {
    return mode === 'demo'
      ? { usable: true, reason: null }
      : { usable: false, reason: 'The research benchmark is a synthetic trace, not a real grid zone; choose a zone for live data.' };
  }
  // Until the catalogue has loaded the backend decides (it refuses what it cannot serve).
  if (!catalogue) return { usable: true, reason: null };
  const z = catalogue.zones.find((c) => c.zone === zone);
  if (!z) return { usable: false, reason: `${zone} is not in the zone catalogue.` };
  if (mode === 'demo') {
    // P13: every catalogue zone works on demo data; zones without their own profile use the generic
    // synthetic trace (labelled; never presented as that zone's data).
    return z.syntheticDemo ? { usable: true, reason: null } : { usable: true, reason: null, generic: true };
  }
  if (!catalogue.liveConfigured) {
    return { usable: false, reason: 'Live data is not configured on this server (no provider key). Use the synthetic demo data.' };
  }
  if (!signedIn) return { usable: false, reason: 'Live data needs sign-in.' };
  if (!z.providerListed.forecast) return { usable: false, reason: 'The provider does not list a carbon-intensity forecast for this zone.' };
  return { usable: true, reason: null };
}

const matches = (z: CatalogueZone, q: string) =>
  `${z.zone} ${z.name} ${z.zoneName} ${z.countryName ?? ''} ${z.countryCode} ${z.continent ?? ''} ${z.area ?? ''}`
    .toLowerCase()
    .includes(q);

type AvailabilityFilter = 'all' | 'verified' | 'demo';

interface Props {
  value: string;
  onChange: (zone: string) => void;
  mode: 'live' | 'demo';
  catalogue: ZoneCatalogue | null;
  error: string | null;
  signedIn: boolean;
}

export const ZoneSelector: React.FC<Props> = ({ value, onChange, mode, catalogue, error, signedIn }) => {
  const [query, setQuery] = useState('');
  const [continent, setContinent] = useState('all');
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const zones = catalogue?.zones ?? [];
  const continents = useMemo(() => [...new Set(zones.map((z) => z.continent).filter(Boolean) as string[])].sort(), [zones]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return zones.filter(
      (z) =>
        (continent === 'all' || z.continent === continent) &&
        (availability === 'all' || (availability === 'verified' ? !!z.verifiedLive : z.syntheticDemo)) &&
        (!q || matches(z, q))
    );
  }, [zones, query, continent, availability]);

  // Group by continent, then UN M49 area (e.g. "Americas · South America").
  const groups = useMemo(() => {
    const m = new Map<string, CatalogueZone[]>();
    for (const z of visible) {
      const key = `${z.continent ?? 'Other'} · ${z.area ?? z.continent ?? 'Other'}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(z);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const selected = zones.find((z) => z.zone === value);
  const usable = zoneUsability(value, mode, catalogue, signedIn);
  const selectedHidden = value !== BENCHMARK_ZONE && !visible.some((z) => z.zone === value);
  const showBenchmark = mode === 'demo' && (!query.trim() || BENCHMARK_ZONE.toLowerCase().includes(query.trim().toLowerCase()) || 'research benchmark'.includes(query.trim().toLowerCase()));

  const control = 'w-full min-w-0 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-white text-xs focus:outline-none focus:border-emerald-500';

  return (
    <div className="space-y-1.5 min-w-0">
      <label className="text-slate-300 font-semibold block" htmlFor="region-select">
        Target Grid Region
      </label>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${zones.length || ''} zones: name, id, country, continent`}
        aria-label="Search grid zones"
        className={control}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <select aria-label="Filter by continent" value={continent} onChange={(e) => setContinent(e.target.value)} className={control}>
          <option value="all">All continents</option>
          {continents.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select aria-label="Filter by availability" value={availability} onChange={(e) => setAvailability(e.target.value as AvailabilityFilter)} className={control}>
          <option value="all">All zones</option>
          <option value="verified">Live data verified</option>
          <option value="demo">Own synthetic demo profile</option>
        </select>
      </div>
      <select
        id="region-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
      >
        {showBenchmark && (
          <optgroup label="Synthetic research benchmark (not a real zone)">
            <option value={BENCHMARK_ZONE}>{BENCHMARK_ZONE} — Controlled research benchmark (synthetic)</option>
          </optgroup>
        )}
        {selectedHidden && (
          <optgroup label="Selected (outside the current filter)">
            <option value={value}>{selected ? `${selected.zone} — ${selected.name}` : value}</option>
          </optgroup>
        )}
        {groups.map(([label, list]) => (
          <optgroup key={label} label={label}>
            {list.map((z) => (
              <option key={z.zone} value={z.zone}>
                {z.zone} — {z.name}
                {z.countryName && z.countryName !== z.name ? ` (${z.countryName})` : ''}
                {z.verifiedLive ? ' · live verified' : ''}
                {z.syntheticDemo ? ' · demo' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-[10px] text-slate-500" data-testid="zone-count">
        {error
          ? `Zone catalogue unavailable: ${error}`
          : catalogue
            ? `Showing ${visible.length} of ${zones.length} zones (catalogue ${catalogue.meta.version}). Every zone is selectable.`
            : 'Loading the zone catalogue…'}
      </p>
      <ZoneDetails zone={selected} value={value} mode={mode} usable={usable} liveConfigured={catalogue?.liveConfigured ?? false} />
    </div>
  );
};

const Badge: React.FC<{ ok: boolean | null; children: React.ReactNode }> = ({ ok, children }) => (
  <li className={`flex gap-1.5 ${ok === null ? 'text-slate-400' : ok ? 'text-emerald-300' : 'text-slate-500'}`}>
    <span aria-hidden="true">{ok === null ? '•' : ok ? '✓' : '✗'}</span>
    <span>{children}</span>
  </li>
);

const ZoneDetails: React.FC<{ zone: CatalogueZone | undefined; value: string; mode: 'live' | 'demo'; usable: ZoneUsability; liveConfigured: boolean }> = ({
  zone,
  value,
  mode,
  usable,
  liveConfigured,
}) => (
  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[10px] leading-relaxed space-y-1.5" data-testid="zone-availability" aria-live="polite">
    {value === BENCHMARK_ZONE ? (
      <p className="text-amber-200">Synthetic research benchmark trace: not a real grid zone and not real data.</p>
    ) : zone ? (
      <>
        <p className="text-slate-300">
          <strong className="text-white">{zone.zone}</strong> · {zone.name}
          {zone.countryName ? ` · ${zone.countryName}` : ''} · {zone.continent}
          {zone.area && zone.area !== zone.continent ? ` / ${zone.area}` : ''} ·{' '}
          {zone.timezone ? `local time ${zone.timezone}` : 'local time zone unresolved (times in UTC)'}
          {zone.aggregate ? ` · aggregate of ${zone.subZones.length} zones` : ''}
        </p>
        <ul className="grid sm:grid-cols-2 gap-x-3">
          <Badge ok={true}>In the verified zone catalogue</Badge>
          <Badge ok={zone.providerListed.forecast}>Forecast listed by the provider (trial key; not verified)</Badge>
          <Badge ok={zone.providerListed.history}>24 h history listed by the provider (not verified)</Badge>
          <Badge ok={!!zone.verifiedLive}>{zone.verifiedLive ? `Live data verified (${zone.verifiedLive.evidence})` : 'Live data not verified for this zone'}</Badge>
          <Badge ok={zone.syntheticDemo}>{zone.syntheticDemo ? 'Own synthetic demo profile' : 'No own demo profile (demo uses the generic synthetic trace)'}</Badge>
          <Badge ok={liveConfigured}>Live data configured on this server</Badge>
        </ul>
      </>
    ) : (
      <p className="text-slate-400">{value}</p>
    )}
    <p className={usable.usable ? 'text-emerald-300 font-bold' : 'text-amber-300 font-bold'} data-testid="zone-usable">
      {usable.usable
        ? usable.generic
          ? `Can be scheduled with the generic synthetic trace: the same synthetic curve used for every zone without its own profile, not ${value} data.`
          : `Can be scheduled with ${mode === 'demo' ? 'synthetic demo data' : 'live data'}.`
        : `Not available for ${mode === 'demo' ? 'demo' : 'live'} scheduling: ${usable.reason}`}
    </p>
  </div>
);

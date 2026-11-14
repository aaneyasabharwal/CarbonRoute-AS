/**
 * IANA time zones for Electricity Maps zones.
 *
 * The provider does not return a time zone for a zone, so this is a curated mapping
 * (IANA tz database names). It is used only for displaying local times; all data is
 * stored and compared in UTC. Zones spanning several time zones, or not listed here,
 * map to null and are shown in UTC only, rather than guessing.
 */

import { catalogueZone } from './zoneCatalogue';

/** Zone codes that need their own entry (sub-national zones or multi-time-zone countries). */
const ZONE_OVERRIDES: Record<string, string> = {
  // United States (only balancing areas that sit within one time zone)
  'US-CAL-CISO': 'America/Los_Angeles',
  'US-CAL-BANC': 'America/Los_Angeles',
  'US-CAL-IID': 'America/Los_Angeles',
  'US-CAL-LDWP': 'America/Los_Angeles',
  'US-CAL-TIDC': 'America/Los_Angeles',
  'US-NW-BPAT': 'America/Los_Angeles',
  'US-NW-PACW': 'America/Los_Angeles',
  'US-NW-PGE': 'America/Los_Angeles',
  'US-NW-PSEI': 'America/Los_Angeles',
  'US-NW-SCL': 'America/Los_Angeles',
  'US-NW-TPWR': 'America/Los_Angeles',
  'US-NW-CHPD': 'America/Los_Angeles',
  'US-NW-DOPD': 'America/Los_Angeles',
  'US-NW-GCPD': 'America/Los_Angeles',
  'US-NW-NEVP': 'America/Los_Angeles',
  'US-SW-AZPS': 'America/Phoenix',
  'US-SW-SRP': 'America/Phoenix',
  'US-SW-TEPC': 'America/Phoenix',
  'US-SW-PNM': 'America/Denver',
  'US-NW-PSCO': 'America/Denver',
  'US-TEX-ERCO': 'America/Chicago',
  'US-MIDW-MISO': 'America/Chicago',
  'US-CENT-SWPP': 'America/Chicago',
  'US-MIDA-PJM': 'America/New_York',
  'US-NE-ISNE': 'America/New_York',
  'US-NY-NYIS': 'America/New_York',
  'US-CAR-DUK': 'America/New_York',
  'US-CAR-CPLE': 'America/New_York',
  'US-CAR-CPLW': 'America/New_York',
  'US-CAR-SC': 'America/New_York',
  'US-CAR-SCEG': 'America/New_York',
  'US-FLA-FPL': 'America/New_York',
  'US-FLA-FPC': 'America/New_York',
  'US-FLA-TEC': 'America/New_York',
  'US-FLA-JEA': 'America/New_York',
  'US-HI': 'Pacific/Honolulu',
  'US-AK': 'America/Anchorage',
  // Canada
  'CA-ON': 'America/Toronto',
  'CA-QC': 'America/Toronto',
  'CA-BC': 'America/Vancouver',
  'CA-AB': 'America/Edmonton',
  'CA-MB': 'America/Winnipeg',
  'CA-SK': 'America/Regina',
  'CA-NS': 'America/Halifax',
  'CA-NB': 'America/Moncton',
  'CA-NL': 'America/St_Johns',
  'CA-PE': 'America/Halifax',
  'CA-YT': 'America/Whitehorse',
  // Australia
  'AU-NSW': 'Australia/Sydney',
  'AU-VIC': 'Australia/Melbourne',
  'AU-QLD': 'Australia/Brisbane',
  'AU-SA': 'Australia/Adelaide',
  'AU-TAS': 'Australia/Hobart',
  'AU-WA': 'Australia/Perth',
  'AU-NT': 'Australia/Darwin',
  // Brazil
  'BR-S': 'America/Sao_Paulo',
  'BR-CS': 'America/Sao_Paulo',
  'BR-NE': 'America/Fortaleza',
  // Spain and Portugal (islands)
  'ES-CN-FV': 'Atlantic/Canary',
  'ES-CN-GC': 'Atlantic/Canary',
  'ES-CN-HI': 'Atlantic/Canary',
  'ES-CN-IG': 'Atlantic/Canary',
  'ES-CN-LP': 'Atlantic/Canary',
  'ES-CN-LZ': 'Atlantic/Canary',
  'ES-CN-TE': 'Atlantic/Canary',
  'PT-MA': 'Atlantic/Madeira',
  // Malaysia
  'MY-WM': 'Asia/Kuala_Lumpur',
  'MY-EM': 'Asia/Kuching',
};

/**
 * Countries that use a single time zone; every zone of the country uses it
 * (e.g. IN-NO, IN-SO -> Asia/Kolkata) unless overridden above.
 */
const SINGLE_ZONE_COUNTRIES: Record<string, string> = {
  IN: 'Asia/Kolkata',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  LU: 'Europe/Luxembourg',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  SK: 'Europe/Bratislava',
  HU: 'Europe/Budapest',
  SI: 'Europe/Ljubljana',
  HR: 'Europe/Zagreb',
  RS: 'Europe/Belgrade',
  RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia',
  GR: 'Europe/Athens',
  DK: 'Europe/Copenhagen',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki',
  EE: 'Europe/Tallinn',
  LV: 'Europe/Riga',
  LT: 'Europe/Vilnius',
  IS: 'Atlantic/Reykjavik',
  TR: 'Europe/Istanbul',
  IL: 'Asia/Jerusalem',
  SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  LK: 'Asia/Colombo',
  NP: 'Asia/Kathmandu',
  TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh',
  PH: 'Asia/Manila',
  SG: 'Asia/Singapore',
  HK: 'Asia/Hong_Kong',
  TW: 'Asia/Taipei',
  CN: 'Asia/Shanghai',
  KR: 'Asia/Seoul',
  JP: 'Asia/Tokyo',
  NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg',
  EG: 'Africa/Cairo',
  KE: 'Africa/Nairobi',
  NG: 'Africa/Lagos',
  MA: 'Africa/Casablanca',
};

export function timezoneForZone(zone: string, countryCode?: string): string | null {
  // P11: the global zone catalogue (IANA-checked, every provider zone) is authoritative; a zone it
  // leaves unresolved (an aggregate spanning several time zones) stays null. Zones outside the
  // catalogue fall back to the curated mapping below.
  const entry = catalogueZone(zone);
  if (entry) return entry.timezone;
  if (ZONE_OVERRIDES[zone]) return ZONE_OVERRIDES[zone];
  const country = (countryCode || zone.split('-')[0]).toUpperCase();
  return SINGLE_ZONE_COUNTRIES[country] ?? null;
}

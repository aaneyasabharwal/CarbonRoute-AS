/**
 * Carbon-data types shared by providers, persistence and the scheduling API.
 *
 * Forecasts and observations are deliberately separate types:
 *  - a ForecastSnapshot is a provider's prediction, issued at `issuedAt`;
 *  - an Observation is the provider's historical value for a past interval, which is
 *    either a measurement (isEstimated === false) or the provider's own estimate.
 * All timestamps are ISO-8601 strings in UTC.
 */

export type Granularity = '5_minutes' | '15_minutes' | 'hourly';
export type ForecastHorizonHours = 6 | 24 | 48 | 72;
export type EmissionFactorType = 'lifecycle' | 'direct';

export const GRANULARITY_MINUTES: Record<Granularity, number> = {
  '5_minutes': 5,
  '15_minutes': 15,
  hourly: 60,
};

/** Values verified against the live API on 2026-11-12 (horizonHours=168 was rejected). */
export const ALLOWED_FORECAST_HORIZONS: ForecastHorizonHours[] = [6, 24, 48, 72];
export const ALLOWED_GRANULARITIES: Granularity[] = ['5_minutes', '15_minutes', 'hourly'];

export type DataClass = 'real' | 'synthetic';

export interface ZoneInfo {
  zone: string;
  zoneName: string;
  displayName?: string;
  countryCode?: string;
  countryName?: string;
  parentZone?: string | null;
  tier?: string;
  /** IANA time zone, or null when no reliable mapping is known. */
  timezone: string | null;
  timezoneSource: 'zone-catalogue' | 'curated-mapping' | 'unknown';
  /** Signals this API key can read for the zone, taken from the provider's `access` list. */
  capabilities: {
    latest: boolean;
    history: boolean;
    forecast: boolean;
    pastRange: boolean;
    powerBreakdown: boolean;
  } | null;
}

export interface ForecastPoint {
  /** Start of the interval (UTC). */
  datetime: string;
  carbonIntensity: number; // gCO2eq/kWh
}

export interface ForecastSnapshot {
  provider: 'electricitymaps' | 'synthetic-demo';
  dataClass: DataClass;
  zone: string;
  /** When the provider says this forecast was produced (`updatedAt`), or null if not given. */
  issuedAt: string | null;
  /** When CarbonRoute fetched it. */
  fetchedAt: string;
  horizonHours: number;
  granularity: Granularity;
  emissionFactorType: EmissionFactorType;
  unit: 'gCO2eq/kWh';
  points: ForecastPoint[];
  endpoint: string;
  rawSha256: string | null;
}

export type ObservationQuality = 'measured' | 'provider-estimate';

export interface Observation {
  zone: string;
  /** Start of the interval (UTC). */
  datetime: string;
  granularity: Granularity;
  carbonIntensity: number; // gCO2eq/kWh
  isEstimated: boolean;
  estimationMethod: string | null;
  quality: ObservationQuality;
  emissionFactorType: EmissionFactorType;
  providerUpdatedAt: string | null;
  fetchedAt: string;
  provider: 'electricitymaps';
}

export interface LatestIntensity {
  zone: string;
  datetime: string;
  carbonIntensity: number;
  isEstimated: boolean;
  estimationMethod: string | null;
  quality: ObservationQuality;
  emissionFactorType: EmissionFactorType;
  granularity: Granularity;
  providerUpdatedAt: string | null;
  fetchedAt: string;
}

export interface PowerBreakdown {
  zone: string;
  datetime: string;
  fossilFreePercentage: number | null;
  renewablePercentage: number | null;
  powerConsumptionTotal: number | null;
  powerProductionTotal: number | null;
  powerConsumptionBreakdown: Record<string, number | null>;
  powerProductionBreakdown: Record<string, number | null>;
  isEstimated: boolean;
  estimationMethod: string | null;
  quality: ObservationQuality;
  providerUpdatedAt: string | null;
  fetchedAt: string;
}

export type ProviderErrorCode =
  | 'NO_API_KEY'
  | 'UNAUTHORIZED'
  | 'NOT_IN_PLAN'
  | 'UNSUPPORTED_ZONE'
  | 'INVALID_PARAMETER'
  | 'RATE_LIMITED'
  /** CarbonRoute's own call budget for the provider is used up (F9). */
  | 'QUOTA_GUARD'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'UPSTREAM_ERROR'
  | 'BAD_RESPONSE';

/** An error from a carbon-data provider. Messages never contain the API key. */
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  /** HTTP status CarbonRoute's own API should return for this error. */
  get apiStatus(): number {
    switch (this.code) {
      case 'UNSUPPORTED_ZONE':
      case 'INVALID_PARAMETER':
        return 422;
      case 'RATE_LIMITED':
      case 'QUOTA_GUARD':
        return 429;
      default:
        return 503;
    }
  }
}

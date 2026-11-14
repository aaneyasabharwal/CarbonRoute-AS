/**
 * Electricity Maps API v3 client.
 *
 * Capabilities verified against the live API on 2026-11-12 with a 14-day trial key:
 *  - carbon-intensity/latest, /history (last 24 h only), /forecast (horizons 6/24/48/72 h),
 *    power-breakdown/latest and zones: available;
 *  - granularities 5_minutes, 15_minutes and hourly: available;
 *  - carbon-intensity/past and /past-range: refused ("not included in your API trial").
 *
 * The API key is read from ELECTRICITY_MAPS_API_KEY (or passed in) and only ever sent in
 * the `auth-token` request header. It is never logged, returned or put in an error message.
 */
import crypto from 'crypto';
import { config } from '../config';
import {
  ALLOWED_FORECAST_HORIZONS,
  ALLOWED_GRANULARITIES,
  EmissionFactorType,
  ForecastHorizonHours,
  ForecastSnapshot,
  GRANULARITY_MINUTES,
  Granularity,
  LatestIntensity,
  Observation,
  PowerBreakdown,
  ProviderError,
  ZoneInfo,
} from './types';
import { timezoneForZone } from './zoneTimezones';

export const ELECTRICITY_MAPS_BASE_URL = 'https://api.electricitymaps.com/v3';
const ZONE_PATTERN = /^[A-Z]{2}(-[A-Z0-9]{1,8}){0,3}$/;

export interface ElectricityMapsClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Longest Retry-After the client will wait for before giving up with RATE_LIMITED. */
  maxRetryAfterSeconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cacheTtlMs?: Partial<Record<'zones' | 'latest' | 'history' | 'forecast' | 'powerBreakdown', number>>;
  /**
   * Server-wide budget of network requests to the provider (F9). Cache hits do not count.
   * Defaults: EM_MAX_CALLS_PER_HOUR (120) and EM_MAX_CALLS_PER_DAY (1500).
   */
  maxCallsPerHour?: number;
  maxCallsPerDay?: number;
}

const budgetFromEnv = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};

const DEFAULT_TTL = {
  zones: 24 * 3600_000,
  latest: 5 * 60_000,
  history: 5 * 60_000,
  forecast: 5 * 60_000,
  powerBreakdown: 5 * 60_000,
};

interface RawResult {
  json: any;
  rawSha256: string;
  endpoint: string;
}

export class ElectricityMapsClient {
  private readonly cache = new Map<string, { expires: number; value: RawResult }>();
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRetryAfterSeconds: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly ttl: typeof DEFAULT_TTL;
  /** Times of recent network requests, for the call budget. */
  private callTimes: number[] = [];

  constructor(private readonly options: ElectricityMapsClientOptions = {}) {
    this.baseUrl = (options.baseUrl || ELECTRICITY_MAPS_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 10;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.ttl = { ...DEFAULT_TTL, ...(options.cacheTtlMs || {}) };
  }

  /** True when a key is configured (the key itself is never exposed). */
  isConfigured(): boolean {
    return this.apiKey().length > 0;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /** Network requests made in the last hour and day, and the budget (no secrets). */
  callBudget(): { lastHour: number; lastDay: number; maxPerHour: number; maxPerDay: number } {
    const now = this.now();
    this.callTimes = this.callTimes.filter((t) => t > now - 24 * 3600_000);
    return {
      lastHour: this.callTimes.filter((t) => t > now - 3600_000).length,
      lastDay: this.callTimes.length,
      maxPerHour: this.options.maxCallsPerHour ?? budgetFromEnv('EM_MAX_CALLS_PER_HOUR', 120),
      maxPerDay: this.options.maxCallsPerDay ?? budgetFromEnv('EM_MAX_CALLS_PER_DAY', 1500),
    };
  }

  /** Refuses a network request once the hourly or daily budget is used up (F9). */
  private reserveCall(): void {
    const b = this.callBudget();
    if (b.lastHour >= b.maxPerHour || b.lastDay >= b.maxPerDay) {
      const period = b.lastHour >= b.maxPerHour ? 'hourly' : 'daily';
      throw new ProviderError(
        'QUOTA_GUARD',
        `CarbonRoute's ${period} Electricity Maps call budget is used up; live data is paused to protect the API quota. Cached data and demo mode still work.`
      );
    }
    this.callTimes.push(this.now());
  }

  private apiKey(): string {
    return (this.options.apiKey ?? process.env.ELECTRICITY_MAPS_API_KEY ?? config.electricityMapsApiKey ?? '').trim();
  }

  private scrub(text: string): string {
    const key = this.apiKey();
    return key ? String(text).split(key).join('[REDACTED]') : String(text);
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------

  private async request(path: string, params: Record<string, string | undefined>, ttlMs: number): Promise<RawResult> {
    const key = this.apiKey();
    if (!key) {
      throw new ProviderError('NO_API_KEY', 'Electricity Maps API key is not configured (set ELECTRICITY_MAPS_API_KEY).');
    }
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const endpoint = `${path}${query ? `?${query}` : ''}`;
    const cached = this.cache.get(endpoint);
    if (cached && cached.expires > this.now()) return cached.value;

    let lastError: ProviderError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(Math.min(4000, 500 * 2 ** (attempt - 1)));
      this.reserveCall();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      let text: string;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
          headers: { 'auth-token': key },
          signal: controller.signal,
        });
        text = await res.text();
      } catch (err: any) {
        clearTimeout(timer);
        lastError =
          err?.name === 'AbortError'
            ? new ProviderError('TIMEOUT', `Electricity Maps did not respond within ${this.timeoutMs} ms.`)
            : new ProviderError('NETWORK', `Network request failed while contacting Electricity Maps: ${this.scrub(err?.message || 'unknown error')}`);
        continue; // transient: retry
      }
      clearTimeout(timer);

      if (res.ok) {
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new ProviderError('BAD_RESPONSE', 'Electricity Maps returned a response that is not valid JSON.', res.status);
        }
        const value: RawResult = {
          json,
          rawSha256: crypto.createHash('sha256').update(text).digest('hex'),
          endpoint,
        };
        this.cache.set(endpoint, { expires: this.now() + ttlMs, value });
        return value;
      }

      const message = this.scrub(this.messageOf(text) || res.statusText || `HTTP ${res.status}`);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1;
        lastError = new ProviderError('RATE_LIMITED', `Electricity Maps rate limit reached: ${message}`, 429, wait);
        if (attempt < this.maxRetries && wait <= this.maxRetryAfterSeconds) {
          await this.sleep(wait * 1000);
          continue;
        }
        throw lastError;
      }
      if (res.status >= 500) {
        lastError = new ProviderError('UPSTREAM_ERROR', `Electricity Maps server error (HTTP ${res.status}): ${message}`, res.status);
        continue; // transient: retry
      }
      if (res.status === 401 || res.status === 403) {
        if (/not included in your/i.test(message)) {
          throw new ProviderError('NOT_IN_PLAN', `This Electricity Maps endpoint is not included in the current API plan: ${message}`, res.status);
        }
        throw new ProviderError('UNAUTHORIZED', `Electricity Maps rejected the API key: ${message}`, res.status);
      }
      if (res.status === 400 || res.status === 404) {
        if (/zone .* does not exist|unknown zone|zone not found/i.test(message)) {
          throw new ProviderError('UNSUPPORTED_ZONE', message, res.status);
        }
        throw new ProviderError('INVALID_PARAMETER', `Electricity Maps rejected the request: ${message}`, res.status);
      }
      throw new ProviderError('UPSTREAM_ERROR', `Electricity Maps responded with HTTP ${res.status}: ${message}`, res.status);
    }
    throw lastError ?? new ProviderError('NETWORK', 'Electricity Maps request failed.');
  }

  private messageOf(text: string): string | null {
    try {
      const j = JSON.parse(text);
      return typeof j?.message === 'string' ? j.message : typeof j?.error === 'string' ? j.error : null;
    } catch {
      return text ? text.slice(0, 200) : null;
    }
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  static validateZone(zone: string): string {
    const z = String(zone || '').trim().toUpperCase();
    if (!ZONE_PATTERN.test(z)) {
      throw new ProviderError('INVALID_PARAMETER', `"${String(zone).slice(0, 40)}" is not a valid grid zone code (e.g. DE, GB, IN-NO, US-CAL-CISO).`);
    }
    return z;
  }

  static validateGranularity(g: string | undefined): Granularity {
    const value = (g || 'hourly') as Granularity;
    if (!ALLOWED_GRANULARITIES.includes(value)) {
      throw new ProviderError('INVALID_PARAMETER', `Unsupported granularity "${g}". Allowed: ${ALLOWED_GRANULARITIES.join(', ')}.`);
    }
    return value;
  }

  static validateHorizon(h: number | string | undefined): ForecastHorizonHours {
    const value = Number(h ?? 24) as ForecastHorizonHours;
    if (!ALLOWED_FORECAST_HORIZONS.includes(value)) {
      throw new ProviderError('INVALID_PARAMETER', `Unsupported forecast horizon "${h}". Allowed: ${ALLOWED_FORECAST_HORIZONS.join(', ')} hours.`);
    }
    return value;
  }

  /** Smallest supported horizon covering `hours`, or null when even 72 h is too short. */
  static horizonCovering(hours: number): ForecastHorizonHours | null {
    return ALLOWED_FORECAST_HORIZONS.find((h) => h >= hours) ?? null;
  }

  static validateEmissionFactor(e: string | undefined): EmissionFactorType {
    const value = (e || 'lifecycle') as EmissionFactorType;
    if (value !== 'lifecycle' && value !== 'direct') {
      throw new ProviderError('INVALID_PARAMETER', `Unsupported emission factor type "${e}". Allowed: lifecycle, direct.`);
    }
    return value;
  }

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  async getZones(): Promise<ZoneInfo[]> {
    const { json } = await this.request('/zones', {}, this.ttl.zones);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new ProviderError('BAD_RESPONSE', 'Electricity Maps zone list has an unexpected format.');
    }
    return Object.entries(json as Record<string, any>)
      .map(([code, z]) => parseZone(code, z))
      .sort((a, b) => a.zone.localeCompare(b.zone));
  }

  async getLatest(zoneInput: string, opts: { granularity?: string; emissionFactorType?: string } = {}): Promise<LatestIntensity> {
    const zone = ElectricityMapsClient.validateZone(zoneInput);
    const granularity = ElectricityMapsClient.validateGranularity(opts.granularity);
    const emissionFactorType = ElectricityMapsClient.validateEmissionFactor(opts.emissionFactorType);
    const { json } = await this.request(
      '/carbon-intensity/latest',
      { zone, temporalGranularity: granularity === 'hourly' ? undefined : granularity, emissionFactorType: emissionFactorType === 'lifecycle' ? undefined : emissionFactorType },
      this.ttl.latest
    );
    if (!isFiniteNonNegative(json?.carbonIntensity) || !isValidDate(json?.datetime)) {
      throw new ProviderError('BAD_RESPONSE', `Electricity Maps returned no valid latest carbon intensity for ${zone}.`);
    }
    const isEstimated = json.isEstimated !== false;
    return {
      zone,
      datetime: toUtc(json.datetime),
      carbonIntensity: json.carbonIntensity,
      isEstimated,
      estimationMethod: json.estimationMethod ?? null,
      quality: isEstimated ? 'provider-estimate' : 'measured',
      emissionFactorType: (json.emissionFactorType as EmissionFactorType) || emissionFactorType,
      granularity,
      providerUpdatedAt: json.updatedAt ? toUtc(json.updatedAt) : null,
      fetchedAt: new Date(this.now()).toISOString(),
    };
  }

  /**
   * Realized values for the last 24 hours (the only historical window the trial allows).
   * Points with a missing value are left out (reported via `missing`), never filled in.
   */
  async getHistory(
    zoneInput: string,
    opts: { granularity?: string; emissionFactorType?: string } = {}
  ): Promise<{ observations: Observation[]; missing: string[]; endpoint: string; rawSha256: string }> {
    const zone = ElectricityMapsClient.validateZone(zoneInput);
    const granularity = ElectricityMapsClient.validateGranularity(opts.granularity);
    const emissionFactorType = ElectricityMapsClient.validateEmissionFactor(opts.emissionFactorType);
    const { json, endpoint, rawSha256 } = await this.request(
      '/carbon-intensity/history',
      { zone, temporalGranularity: granularity === 'hourly' ? undefined : granularity, emissionFactorType: emissionFactorType === 'lifecycle' ? undefined : emissionFactorType },
      this.ttl.history
    );
    if (!Array.isArray(json?.history)) {
      throw new ProviderError('BAD_RESPONSE', `Electricity Maps history for ${zone} has an unexpected format.`);
    }
    const fetchedAt = new Date(this.now()).toISOString();
    const missing: string[] = [];
    const byTime = new Map<string, Observation>();
    for (const p of json.history) {
      if (!isValidDate(p?.datetime)) continue;
      const datetime = toUtc(p.datetime);
      if (!isFiniteNonNegative(p.carbonIntensity)) {
        missing.push(datetime);
        continue;
      }
      // A point is only "measured" when the provider explicitly says it is not estimated.
      const isEstimated = p.isEstimated !== false;
      byTime.set(datetime, {
        zone,
        datetime,
        granularity,
        carbonIntensity: p.carbonIntensity,
        isEstimated,
        estimationMethod: p.estimationMethod ?? null,
        quality: isEstimated ? 'provider-estimate' : 'measured',
        emissionFactorType: (p.emissionFactorType as EmissionFactorType) || emissionFactorType,
        providerUpdatedAt: p.updatedAt ? toUtc(p.updatedAt) : null,
        fetchedAt,
        provider: 'electricitymaps',
      });
    }
    const observations = [...byTime.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));
    return { observations, missing, endpoint, rawSha256 };
  }

  async getForecast(
    zoneInput: string,
    opts: { horizonHours?: number | string; granularity?: string; emissionFactorType?: string } = {}
  ): Promise<ForecastSnapshot> {
    const zone = ElectricityMapsClient.validateZone(zoneInput);
    const horizonHours = ElectricityMapsClient.validateHorizon(opts.horizonHours);
    const granularity = ElectricityMapsClient.validateGranularity(opts.granularity);
    const emissionFactorType = ElectricityMapsClient.validateEmissionFactor(opts.emissionFactorType);
    const { json, endpoint, rawSha256 } = await this.request(
      '/carbon-intensity/forecast',
      {
        zone,
        horizonHours: String(horizonHours),
        temporalGranularity: granularity === 'hourly' ? undefined : granularity,
        emissionFactorType: emissionFactorType === 'lifecycle' ? undefined : emissionFactorType,
      },
      this.ttl.forecast
    );
    if (!Array.isArray(json?.forecast) || json.forecast.length === 0) {
      throw new ProviderError('BAD_RESPONSE', `Electricity Maps returned an empty forecast for ${zone}.`);
    }
    const points = parseForecastPoints(json.forecast, granularity, zone);
    return {
      provider: 'electricitymaps',
      dataClass: 'real',
      zone,
      issuedAt: json.updatedAt && isValidDate(json.updatedAt) ? toUtc(json.updatedAt) : null,
      fetchedAt: new Date(this.now()).toISOString(),
      horizonHours,
      granularity,
      emissionFactorType,
      unit: 'gCO2eq/kWh',
      points,
      endpoint,
      rawSha256,
    };
  }

  async getPowerBreakdown(zoneInput: string): Promise<PowerBreakdown> {
    const zone = ElectricityMapsClient.validateZone(zoneInput);
    const { json } = await this.request('/power-breakdown/latest', { zone }, this.ttl.powerBreakdown);
    if (!isValidDate(json?.datetime)) {
      throw new ProviderError('BAD_RESPONSE', `Electricity Maps returned no valid power breakdown for ${zone}.`);
    }
    const isEstimated = json.isEstimated !== false;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      zone,
      datetime: toUtc(json.datetime),
      fossilFreePercentage: num(json.fossilFreePercentage),
      renewablePercentage: num(json.renewablePercentage),
      powerConsumptionTotal: num(json.powerConsumptionTotal),
      powerProductionTotal: num(json.powerProductionTotal),
      powerConsumptionBreakdown: json.powerConsumptionBreakdown || {},
      powerProductionBreakdown: json.powerProductionBreakdown || {},
      isEstimated,
      estimationMethod: json.estimationMethod ?? null,
      quality: isEstimated ? 'provider-estimate' : 'measured',
      providerUpdatedAt: json.updatedAt ? toUtc(json.updatedAt) : null,
      fetchedAt: new Date(this.now()).toISOString(),
    };
  }
}

// -----------------------------------------------------------------------------
// Parsing helpers (exported for tests)
// -----------------------------------------------------------------------------

export function parseZone(code: string, z: any): ZoneInfo {
  const access: string[] | undefined = Array.isArray(z?.access) ? z.access : undefined;
  const has = (a: string) => !!access && access.includes(a);
  return {
    zone: code,
    zoneName: z?.zoneName || code,
    displayName: z?.displayName,
    countryCode: z?.countryCode,
    countryName: z?.countryName,
    parentZone: z?.zoneParentKey ?? null,
    tier: z?.tier,
    timezone: timezoneForZone(code, z?.countryCode),
    timezoneSource: timezoneForZone(code, z?.countryCode) ? 'zone-catalogue' : 'unknown',
    capabilities: access
      ? {
          latest: has('carbon-intensity/latest'),
          history: has('carbon-intensity/history'),
          forecast: has('carbon-intensity/forecast'),
          pastRange: has('carbon-intensity/past-range'),
          powerBreakdown: has('power-breakdown/latest'),
        }
      : null,
  };
}

/**
 * Validates and normalises forecast points: UTC timestamps, sorted, no duplicates with
 * conflicting values, and a constant step equal to the requested granularity.
 * A gap or an invalid value is an error; nothing is filled in.
 */
export function parseForecastPoints(raw: any[], granularity: Granularity, zone: string) {
  const byTime = new Map<string, number>();
  for (const p of raw) {
    if (!isValidDate(p?.datetime) || !isFiniteNonNegative(p?.carbonIntensity)) {
      throw new ProviderError('BAD_RESPONSE', `Electricity Maps forecast for ${zone} contains an invalid point.`);
    }
    const t = toUtc(p.datetime);
    if (byTime.has(t) && byTime.get(t) !== p.carbonIntensity) {
      throw new ProviderError('BAD_RESPONSE', `Electricity Maps forecast for ${zone} contains conflicting values for ${t}.`);
    }
    byTime.set(t, p.carbonIntensity);
  }
  const points = [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([datetime, carbonIntensity]) => ({ datetime, carbonIntensity }));
  const stepMs = GRANULARITY_MINUTES[granularity] * 60_000;
  for (let i = 1; i < points.length; i++) {
    const delta = Date.parse(points[i].datetime) - Date.parse(points[i - 1].datetime);
    if (delta !== stepMs) {
      throw new ProviderError(
        'BAD_RESPONSE',
        `Electricity Maps forecast for ${zone} has a gap or irregular step between ${points[i - 1].datetime} and ${points[i].datetime}.`
      );
    }
  }
  return points;
}

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function toUtc(v: string): string {
  return new Date(Date.parse(v)).toISOString();
}

/** Shared client used by the API. Tests create their own instances. */
export const electricityMaps = new ElectricityMapsClient();

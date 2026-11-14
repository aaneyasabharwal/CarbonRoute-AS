import { ElectricityMapsClient, electricityMaps } from '../carbon/electricityMaps';
import { ForecastSnapshot, ZoneInfo, ProviderError } from '../carbon/types';
import { timezoneForZone } from '../carbon/zoneTimezones';

export interface HourlyCarbonPoint {
  hour: number;
  offsetHour: number;
  timestamp: string;
  predictedCarbon: number; // gCO2eq/kWh
  carbonIntensity: number; // alias for consistency
  /**
   * Forecast uncertainty (standard deviation, gCO2eq/kWh). Null when the provider gives
   * none: Electricity Maps forecasts carry no uncertainty, and none is invented for them.
   */
  stdDev: number | null;
  uncertainty: number | null; // alias
  uncertaintyStdDev: number | null; // alias
  confidenceLow: number | null;
  confidenceHigh: number | null;
}

export interface CarbonForecastData {
  source: string;
  region: string;
  regionName: string;
  timestamp: string;
  dataMode: 'live' | 'demo';
  /** 'real' for provider data, 'synthetic' for the built-in demo profiles. */
  dataClass: 'real' | 'synthetic';
  /**
   * Where the per-point uncertainty comes from: the demo's synthetic model, or
   * 'unavailable' when the provider does not supply any.
   */
  uncertaintySource: 'synthetic-demo-model' | 'unavailable';
  traceVersion: string;
  forecastHorizonHours: number;
  timeResolution: string;
  hourlyProfile: HourlyCarbonPoint[];
  averageCarbon: number;
  minCarbon: number;
  maxCarbon: number;
  /** IANA time zone of the zone for display, or null if unknown. Timestamps are UTC. */
  timezone: string | null;
  /** The exact provider forecast (live mode only), including issue and fetch times. */
  snapshot?: ForecastSnapshot;
}

export interface ICarbonDataProvider {
  name: string;
  source: string;
  dataMode: 'live' | 'demo';
  getForecast(region: string, horizonHours?: number): Promise<CarbonForecastData>;
  getAvailableRegions(): Array<{ code: string; name: string }>;
}

// Realistic 24-hour baseline traces representing characteristic regional grid mixes
export const REGIONAL_PROFILES: Record<
  string,
  { name: string; baseCurve: number[]; baseStdDev: number[] }
> = {
  'BENCHMARK-RESEARCH': {
    name: 'DEMO / BENCHMARK - Controlled Uncertainty Experiment',
    // T+0 has relatively high carbon (340) and low uncertainty (10).
    // T+2/T+3 has lower carbon (220-210) with acceptable risk (slack ~ 8h).
    // T+10/T+11 has lowest predicted carbon (135-130), but high uncertainty (50-55) & 0-1h slack -> risk > tolerance!
    baseCurve: [
      340, 320, 220, 215, 230, 270, 310, 330, 210, 180,
      135, 130, 160, 210, 260, 300, 340, 370, 360, 340,
      320, 310, 300, 290,
    ],
    baseStdDev: [
      10, 12, 15, 16, 18, 22, 26, 30, 36, 42,
      50, 55, 58, 62, 65, 68, 72, 75, 78, 80,
      82, 85, 88, 90,
    ],
  },
  'US-CAL-CISO': {
    name: 'California (CAISO)',
    // Solar duck-curve: high morning/evening carbon, steep clean solar drop during midday hours 10–16
    baseCurve: [
      310, 295, 285, 280, 290, 320, 360, 340, 280, 220,
      170, 150, 140, 145, 160, 190, 260, 350, 390, 370,
      340, 320, 310, 305,
    ],
    baseStdDev: [
      10, 11, 12, 14, 15, 18, 22, 25, 28, 32,
      35, 38, 40, 42, 45, 48, 52, 58, 62, 65,
      68, 70, 72, 75,
    ],
  },
  'US-TEX-ERCO': {
    name: 'Texas (ERCOT)',
    // Overnight wind generation (clean), thermal gas generation peak during late afternoon
    baseCurve: [
      230, 210, 195, 190, 205, 240, 280, 310, 330, 345,
      360, 375, 390, 410, 420, 410, 390, 360, 320, 290,
      270, 250, 240, 235,
    ],
    baseStdDev: [
      12, 13, 15, 16, 18, 22, 26, 30, 34, 38,
      42, 45, 49, 53, 58, 62, 66, 70, 74, 78,
      80, 83, 85, 88,
    ],
  },
  'DE': {
    name: 'Germany (Central Europe)',
    // Mixed solar/wind grid with lignite baseload and industrial daytime demand
    baseCurve: [
      380, 365, 350, 340, 355, 390, 430, 410, 370, 310,
      260, 230, 215, 225, 250, 290, 360, 420, 450, 430,
      410, 395, 390, 385,
    ],
    baseStdDev: [
      15, 16, 18, 20, 22, 26, 30, 35, 40, 44,
      48, 52, 55, 58, 62, 66, 71, 76, 80, 84,
      87, 90, 92, 95,
    ],
  },
  'IN-NO': {
    name: 'Northern India Grid',
    // High thermal baseload with prominent midday solar penetration and steep evening lighting peak
    baseCurve: [
      640, 630, 620, 615, 630, 670, 710, 680, 610, 540,
      480, 450, 440, 455, 490, 560, 660, 740, 780, 760,
      720, 680, 660, 650,
    ],
    baseStdDev: [
      18, 20, 22, 25, 28, 34, 40, 46, 52, 58,
      64, 70, 75, 80, 86, 92, 98, 105, 112, 118,
      122, 126, 130, 135,
    ],
  },
};

/**
 * Clean data provider serving calibrated research benchmark traces.
 * Identifies internally as demo/prepared trace data.
 */
export class PreparedTraceDataProvider implements ICarbonDataProvider {
  public name = 'PreparedTraceDataProvider';
  public source = 'Controlled Research Benchmark / Demo Trace';
  public dataMode: 'live' | 'demo' = 'demo';

  public async getForecast(
    region: string = 'BENCHMARK-RESEARCH',
    horizonHours: number = 24,
    nowMs: number = Date.now()
  ): Promise<CarbonForecastData> {
    const validHorizon = Math.max(1, Math.min(48, Number(horizonHours) || 24));
    // P11: never substitute another region. A zone without a synthetic profile is refused with the
    // list of zones that have one (before P11 it silently got the BENCHMARK-RESEARCH trace).
    if (!REGIONAL_PROFILES[region]) {
      throw new ProviderError(
        'INVALID_PARAMETER',
        `There is no synthetic demo profile for zone ${String(region).slice(0, 40)}. Demo profiles exist for: ${Object.keys(REGIONAL_PROFILES).join(', ')}. Use one of them, or live data where it is configured.`
      );
    }
    const selectedRegion = region;
    const profile = REGIONAL_PROFILES[selectedRegion];
    // P3 / M5.4: the synthetic trace starts at the beginning of the current UTC hour (like the
    // provider's hourly forecasts), so identical requests in the same hour give identical
    // timestamps and decisions.
    const now = new Date(Math.floor(nowMs / 3600000) * 3600000);

    const hourlyProfile: HourlyCarbonPoint[] = [];
    for (let idx = 0; idx < validHorizon; idx++) {
      const dt = new Date(now.getTime() + idx * 3600000);
      const intensity = profile.baseCurve[idx % 24];
      const baseStd = profile.baseStdDev[idx % 24];
      // Uncertainty dispersion growth over horizon: sigma(t) = sigma_0 * (1 + 0.18 * sqrt(t))
      const stdDev = Math.round(baseStd * (1.0 + 0.18 * Math.sqrt(idx)));
      const confidenceLow = Math.max(10, Math.round(intensity - 1.96 * stdDev));
      const confidenceHigh = Math.round(intensity + 1.96 * stdDev);

      hourlyProfile.push({
        hour: idx,
        offsetHour: idx,
        timestamp: dt.toISOString(),
        predictedCarbon: intensity,
        carbonIntensity: intensity,
        stdDev,
        uncertainty: stdDev,
        uncertaintyStdDev: stdDev,
        confidenceLow,
        confidenceHigh,
      });
    }

    const carbons = hourlyProfile.map((p) => p.predictedCarbon);

    return {
      source: this.source,
      region: selectedRegion,
      regionName: profile.name,
      timestamp: now.toISOString(),
      dataMode: this.dataMode,
      dataClass: 'synthetic',
      uncertaintySource: 'synthetic-demo-model',
      timezone: selectedRegion === 'BENCHMARK-RESEARCH' ? null : timezoneForZone(selectedRegion),
      traceVersion: 'v1.0-ucs503-calibrated',
      forecastHorizonHours: validHorizon,
      timeResolution: '60 minutes (Hourly)',
      hourlyProfile,
      averageCarbon: Math.round(carbons.reduce((a, b) => a + b, 0) / carbons.length),
      minCarbon: Math.min(...carbons),
      maxCarbon: Math.max(...carbons),
    };
  }

  public getAvailableRegions(): Array<{ code: string; name: string }> {
    return Object.entries(REGIONAL_PROFILES).map(([code, meta]) => ({
      code,
      name: meta.name,
    }));
  }
}

/**
 * Live Electricity Maps API provider for production integrations.
 * Default data provider for the CarbonRoute Interactive Prototype.
 */
export class ElectricityMapsDataProvider implements ICarbonDataProvider {
  public name = 'ElectricityMapsDataProvider';
  public source = 'Electricity Maps API';
  public dataMode: 'live' | 'demo' = 'live';
  private readonly client: ElectricityMapsClient;

  /**
   * @param apiKey optional key; when omitted the shared client reads ELECTRICITY_MAPS_API_KEY.
   * @param client optional client (tests inject one with a fake fetch or clock).
   */
  constructor(apiKey?: string, client?: ElectricityMapsClient) {
    this.client = client ?? (apiKey !== undefined ? new ElectricityMapsClient({ apiKey }) : electricityMaps);
  }

  /**
   * Hourly forecast for scheduling. The smallest supported horizon (6/24/48/72 h) covering
   * `horizonHours` is requested. Points carry no uncertainty: the provider gives none, and
   * none is invented (audit C3).
   */
  public async getForecast(region: string = 'US-CAL-CISO', horizonHours: number = 24): Promise<CarbonForecastData> {
    let snapshot: ForecastSnapshot;
    try {
      const horizon = ElectricityMapsClient.horizonCovering(Math.max(1, Number(horizonHours) || 24)) ?? 72;
      snapshot = await this.client.getForecast(region, { horizonHours: horizon, granularity: 'hourly' });
    } catch (err: any) {
      const status = err?.httpStatus ? ` (HTTP ${err.httpStatus})` : '';
      const wrapped = new Error(`Live carbon forecast unavailable: ${err?.message || 'unknown error'}${status}`);
      (wrapped as any).code = err?.code;
      (wrapped as any).apiStatus = err?.apiStatus;
      throw wrapped;
    }

    const start = Date.parse(snapshot.points[0].datetime);
    const hourlyProfile: HourlyCarbonPoint[] = snapshot.points.map((p) => ({
      hour: Math.round((Date.parse(p.datetime) - start) / 3600_000),
      offsetHour: Math.round((Date.parse(p.datetime) - start) / 3600_000),
      timestamp: p.datetime,
      predictedCarbon: p.carbonIntensity,
      carbonIntensity: p.carbonIntensity,
      stdDev: null,
      uncertainty: null,
      uncertaintyStdDev: null,
      confidenceLow: null,
      confidenceHigh: null,
    }));
    const carbons = hourlyProfile.map((p) => p.predictedCarbon);
    const profile = REGIONAL_PROFILES[snapshot.zone];

    return {
      source: this.source,
      region: snapshot.zone,
      regionName: profile ? profile.name : snapshot.zone,
      timestamp: snapshot.fetchedAt,
      dataMode: this.dataMode,
      dataClass: 'real',
      uncertaintySource: 'unavailable',
      timezone: timezoneForZone(snapshot.zone),
      traceVersion: 'electricitymaps-v3',
      forecastHorizonHours: snapshot.horizonHours,
      timeResolution: '60 minutes',
      hourlyProfile,
      averageCarbon: Math.round(carbons.reduce((a, b) => a + b, 0) / carbons.length),
      minCarbon: Math.min(...carbons),
      maxCarbon: Math.max(...carbons),
      snapshot,
    };
  }

  public getAvailableRegions(): Array<{ code: string; name: string }> {
    return Object.entries(REGIONAL_PROFILES).map(([code, meta]) => ({
      code,
      name: meta.name,
    }));
  }
}

/**
 * CarbonService dispatcher: ElectricityMapsDataProvider is the DEFAULT provider.
 * PreparedTraceDataProvider is explicitly available when mode === 'demo'.
 * Errors in live mode are NOT suppressed or silently substituted.
 */
export class CarbonService {
  private static liveProvider: ICarbonDataProvider = new ElectricityMapsDataProvider();
  private static preparedProvider: ICarbonDataProvider = new PreparedTraceDataProvider();

  public static getProvider(mode: 'live' | 'demo' = 'live'): ICarbonDataProvider {
    if (mode === 'demo') {
      return this.preparedProvider;
    }
    return this.liveProvider;
  }

  public static async getForecast(
    region: string = 'US-CAL-CISO',
    horizonHours: number = 24,
    mode: 'live' | 'demo' = 'live',
    nowMs?: number
  ): Promise<CarbonForecastData> {
    if (mode === 'demo') return await new PreparedTraceDataProvider().getForecast(region, horizonHours, nowMs);
    const provider = this.getProvider(mode);
    return await provider.getForecast(region, horizonHours);
  }

  /** The built-in synthetic demo profiles (used in demo mode only). */
  public static getAvailableRegions(): Array<{ code: string; name: string }> {
    return this.preparedProvider.getAvailableRegions();
  }

  /** Every zone the configured Electricity Maps key can see, with coverage and time zone. */
  public static async getLiveZones(): Promise<ZoneInfo[]> {
    return electricityMaps.getZones();
  }
}

/**
 * Top-level convenience function matching the specification.
 * Validates region, horizon, and mode.
 */
export async function getForecast(
  region: string = 'US-CAL-CISO',
  horizonHours: number = 24,
  mode: 'live' | 'demo' = 'live'
): Promise<CarbonForecastData> {
  return CarbonService.getForecast(region, horizonHours, mode);
}

/**
 * [legacy] Port of tests/electricity_maps_provider_test.cjs.
 *
 * Characterization tests for the Electricity Maps provider and the demo provider.
 * fetch is always stubbed: no test reaches the network. The response bodies below
 * are hand-written mocks in the shape the current parser expects; they are NOT
 * recorded provider responses (recorded fixtures are task M5.0, pending D1).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  CarbonService,
  ElectricityMapsDataProvider,
  PreparedTraceDataProvider,
  REGIONAL_PROFILES,
} from '../../src/services/carbonService';
import { evaluateAllPolicies, WorkloadJob } from '../../src/services/schedulerService';

type MockResponse = { ok: boolean; status: number; statusText?: string; json?: () => Promise<unknown> };

/**
 * The original script's mocks were bare objects ({ ok, status, json }). Since the M5
 * Electricity Maps client reads `text()` and `headers` like any real fetch Response, each
 * mock is converted into a real Response with the same status and body. Only the mock
 * harness changed; every assertion below is the original one.
 */
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<MockResponse>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const m = await impl(url, init);
    const body = m.json ? JSON.stringify(await m.json()) : null;
    return new Response(body, { status: m.status, statusText: m.statusText });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function forecastBody(values: number[]) {
  // The original mock called Date.now() for every point, so consecutive timestamps drifted by
  // a millisecond. Since M5 the parser rejects irregular or gapped series (audit H5), as real
  // Electricity Maps forecasts are exactly hour-aligned; the mock now is too.
  const start = Math.floor(Date.now() / 3600000) * 3600000;
  return {
    forecast: values.map((v, i) => ({
      datetime: new Date(start + i * 3600000).toISOString(),
      carbonIntensity: v,
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[legacy] Electricity Maps provider', () => {
  it('1. live mode defaults to ElectricityMapsDataProvider; demo mode uses PreparedTraceDataProvider', () => {
    const live = CarbonService.getProvider();
    expect(live).toBeInstanceOf(ElectricityMapsDataProvider);
    expect(live.dataMode).toBe('live');
    const demo = CarbonService.getProvider('demo');
    expect(demo).toBeInstanceOf(PreparedTraceDataProvider);
    expect(demo.dataMode).toBe('demo');
  });

  it('2. a missing API key throws instead of silently falling back to demo data', async () => {
    await expect(new ElectricityMapsDataProvider('').getForecast('US-CAL-CISO', 24)).rejects.toThrow(
      'Live carbon forecast unavailable:'
    );
    await expect(CarbonService.getForecast('US-CAL-CISO', 24, 'live')).rejects.toThrow(
      'Live carbon forecast unavailable:'
    );
  });

  it('3. the requested region is passed as the zone parameter with the auth-token header', async () => {
    const fetchMock = stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => forecastBody(Array.from({ length: 24 }, (_, i) => 200 + i * 5)),
    }));
    const provider = new ElectricityMapsDataProvider('test-mock-api-key');
    const regions = ['US-CAL-CISO', 'US-TEX-ERCO', 'DE', 'IN-NO', 'FR'];
    for (const r of regions) await provider.getForecast(r, 24);

    expect(fetchMock).toHaveBeenCalledTimes(regions.length);
    regions.forEach((r, i) => {
      const [url, init] = fetchMock.mock.calls[i];
      expect(String(url)).toContain(`zone=${encodeURIComponent(r)}`);
      expect((init?.headers as Record<string, string>)['auth-token']).toBe('test-mock-api-key');
    });
  });

  it('4. live intensities are used directly, not the regional base curve', async () => {
    const values = [412, 408, 395, 380, 210, 115, 88, 92, 105, 140, 185, 220, 270, 310, 350, 390, 425, 450, 470, 460, 430, 410, 390, 380];
    stubFetch(async () => ({ ok: true, status: 200, json: async () => forecastBody(values) }));
    const forecast = await new ElectricityMapsDataProvider('test-valid-key').getForecast('US-CAL-CISO', 24);
    expect(forecast.dataMode).toBe('live');
    expect(forecast.hourlyProfile.map((p) => p.predictedCarbon)).toEqual(values);
    expect(forecast.hourlyProfile[0].predictedCarbon).not.toBe(REGIONAL_PROFILES['US-CAL-CISO'].baseCurve[0]);
  });

  it('5. all 5 policies consume the live values with explicit units', async () => {
    const values = Array(24).fill(300);
    values[6] = 75;
    values[7] = 85;
    stubFetch(async () => ({ ok: true, status: 200, json: async () => forecastBody(values) }));
    const live = await new ElectricityMapsDataProvider('test-valid-key').getForecast('US-CAL-CISO', 24);

    const job: WorkloadJob = {
      id: 'live-test-job',
      name: 'Live Job Test',
      commandOrImage: 'test:latest',
      isContainerImage: true,
      durationHours: 2,
      deadlineHours: 12,
      arrivalHour: 0,
      cpu: 4,
      memoryMb: 2048,
      region: 'US-CAL-CISO',
      riskTolerance: 0.1,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const result = evaluateAllPolicies(job, live, 1.0);
    expect(result.evaluatedPolicies).toHaveLength(5);

    const imm = result.evaluatedPolicies.find((p) => p.policyId === 'immediate')!;
    expect(imm.predictedCarbon).toBe(300);
    expect(imm.predictedCarbonIntensity).toBe(300);
    const det = result.evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon')!;
    expect(det.selectedStartHour).toBe(6);
    expect(det.predictedCarbon).toBe(80);

    for (const p of result.evaluatedPolicies) {
      expect(p.carbonIntensityUnit).toBe('gCO2eq/kWh');
      expect(p.workloadEmissionsUnit).toBe('gCO2eq');
      expect(typeof p.predictedCarbonIntensity).toBe('number');
      expect(typeof p.estimatedWorkloadEmissionsGrams).toBe('number');
    }
  });

  it('6. explicit demo mode works without an API key and returns the hardcoded profile', async () => {
    const demo = await CarbonService.getForecast('US-CAL-CISO', 24, 'demo');
    expect(demo.dataMode).toBe('demo');
    expect(demo.hourlyProfile).toHaveLength(24);
    expect(demo.hourlyProfile[0].predictedCarbon).toBe(REGIONAL_PROFILES['US-CAL-CISO'].baseCurve[0]);
  });

  describe('7. error propagation', () => {
    const provider = new ElectricityMapsDataProvider('invalid-or-ratelimited-key');

    it('HTTP 401', async () => {
      stubFetch(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' }));
      await expect(provider.getForecast('US-CAL-CISO', 24)).rejects.toThrow(
        /Live carbon forecast unavailable:.*HTTP 401/
      );
    });

    it('HTTP 429', async () => {
      stubFetch(async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' }));
      await expect(provider.getForecast('US-CAL-CISO', 24)).rejects.toThrow(
        /Live carbon forecast unavailable:.*HTTP 429/
      );
    });

    it('network failure', async () => {
      stubFetch(async () => {
        throw new Error('ENOTFOUND api.electricitymap.org');
      });
      await expect(provider.getForecast('US-CAL-CISO', 24)).rejects.toThrow(
        /Live carbon forecast unavailable:.*Network request failed/
      );
    });

    it('empty forecast array', async () => {
      stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ forecast: [] }) }));
      await expect(provider.getForecast('US-CAL-CISO', 24)).rejects.toThrow(
        /Live carbon forecast unavailable:.*empty forecast/
      );
    });
  });
});

/**
 * CarbonRoute Electricity Maps Live Provider Automated Test Suite
 * 
 * Verifies:
 * 1. Default Provider is ElectricityMapsDataProvider (live mode)
 * 2. Missing or empty API key strictly throws "Live carbon forecast unavailable: ..." without silent fallback
 * 3. Dynamic Region Passing: zone parameter in API URL is dynamically formatted for the requested region
 * 4. Response Parsing: Scheduler consumes actual live forecast values without using REGIONAL_PROFILES baseCurve
 * 5. 5-Scheduler Policy Consumption: policies evaluate over the live returned forecast with correct units
 * 6. Explicit Demo Mode: PreparedTraceDataProvider is available when mode === 'demo'
 * 7. Error Propagation: Network errors, HTTP 401, HTTP 429, and malformed responses propagate with HTTP 503 error format
 */

// Harness changes for the M5 client (assertions below are unchanged):
//  1. A local .env key must never reach this script: the variable is set to empty before the
//     backend config loads (dotenv does not override existing variables).
//  2. The original mocks were bare objects ({ ok, status, json }); the client reads text() and
//     headers like any real Response, so every assigned mock is wrapped into a real Response.
//  3. Mock timestamps are hour-aligned (HOUR0), because the client rejects irregular series (audit H5).
process.env.ELECTRICITY_MAPS_API_KEY = '';
const HOUR0 = Math.floor(Date.now() / 3600000) * 3600000;
let currentFetch = global.fetch;
Object.defineProperty(global, 'fetch', {
  configurable: true,
  get: () => currentFetch,
  set: (fn) => {
    currentFetch = typeof fn !== 'function' ? fn : async (...args) => {
      const r = await fn(...args);
      if (r instanceof Response) return r;
      const body = r && r.json ? JSON.stringify(await r.json()) : null;
      return new Response(body, { status: r.status, statusText: r.statusText });
    };
  },
});

const {
  CarbonService,
  ElectricityMapsDataProvider,
  PreparedTraceDataProvider,
  REGIONAL_PROFILES,
  getForecast,
} = require('../backend/dist/services/carbonService');
const { SchedulerService, evaluateAllPolicies } = require('../backend/dist/services/schedulerService');

async function runElectricityMapsTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 CarbonRoute: Electricity Maps Live Provider Verification');
  console.log('🧪 ========================================================');

  let passed = 0;
  let failed = 0;

  async function assert(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // Save original fetch and env
  const originalFetch = global.fetch;
  const originalEnvKey = process.env.ELECTRICITY_MAPS_API_KEY;

  try {
    // -------------------------------------------------------------
    // TEST 1: Default Provider Verification
    // -------------------------------------------------------------
    await assert('1. CarbonService defaults to ElectricityMapsDataProvider in live mode', async () => {
      const defaultProvider = CarbonService.getProvider();
      if (!(defaultProvider instanceof ElectricityMapsDataProvider)) {
        throw new Error(`Expected ElectricityMapsDataProvider, got ${defaultProvider.name}`);
      }
      if (defaultProvider.dataMode !== 'live') {
        throw new Error(`Expected dataMode 'live', got ${defaultProvider.dataMode}`);
      }

      const demoProvider = CarbonService.getProvider('demo');
      if (!(demoProvider instanceof PreparedTraceDataProvider)) {
        throw new Error(`Expected PreparedTraceDataProvider for demo mode, got ${demoProvider.name}`);
      }
      if (demoProvider.dataMode !== 'demo') {
        throw new Error(`Expected dataMode 'demo', got ${demoProvider.dataMode}`);
      }
    });

    // -------------------------------------------------------------
    // TEST 2: Missing API Key Fails Without Silent Fallback
    // -------------------------------------------------------------
    await assert('2. Missing API key throws "Live carbon forecast unavailable" without silent fallback to demo', async () => {
      delete process.env.ELECTRICITY_MAPS_API_KEY;
      const unconfiguredProvider = new ElectricityMapsDataProvider('');

      let threw = false;
      try {
        await unconfiguredProvider.getForecast('US-CAL-CISO', 24);
      } catch (err) {
        threw = true;
        if (!err.message.includes('Live carbon forecast unavailable:')) {
          throw new Error(`Expected error prefix "Live carbon forecast unavailable:", got: "${err.message}"`);
        }
      }

      if (!threw) {
        throw new Error('Provider silently succeeded or returned fallback data when API key was missing!');
      }

      // Also verify via CarbonService.getForecast in default mode
      let serviceThrew = false;
      try {
        await CarbonService.getForecast('US-CAL-CISO', 24, 'live');
      } catch (err) {
        serviceThrew = true;
        if (!err.message.includes('Live carbon forecast unavailable:')) {
          throw new Error(`Service error missing expected prefix: "${err.message}"`);
        }
      }
      if (!serviceThrew) {
        throw new Error('CarbonService silently returned data in live mode when unconfigured!');
      }
    });

    // -------------------------------------------------------------
    // TEST 3: Dynamic Region Passing to Electricity Maps API
    // -------------------------------------------------------------
    await assert('3. Selected region is dynamically passed as zone parameter in API URL', async () => {
      const recordedUrls = [];
      const recordedHeaders = [];

      global.fetch = async (url, options) => {
        recordedUrls.push(url.toString());
        recordedHeaders.push(options?.headers);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            forecast: Array.from({ length: 24 }, (_, i) => ({
              datetime: new Date(HOUR0 + i * 3600000).toISOString(),
              carbonIntensity: 200 + i * 5,
            })),
          }),
        };
      };

      const testProvider = new ElectricityMapsDataProvider('test-mock-api-key');

      // Test multiple distinct regions
      const regionsToTest = ['US-CAL-CISO', 'US-TEX-ERCO', 'DE', 'IN-NO', 'FR'];
      for (const reg of regionsToTest) {
        await testProvider.getForecast(reg, 24);
      }

      if (recordedUrls.length !== regionsToTest.length) {
        throw new Error(`Expected ${regionsToTest.length} API requests, recorded ${recordedUrls.length}`);
      }

      for (let i = 0; i < regionsToTest.length; i++) {
        const expectedZone = encodeURIComponent(regionsToTest[i]);
        if (!recordedUrls[i].includes(`zone=${expectedZone}`)) {
          throw new Error(`Request ${i} did not include zone=${expectedZone}. URL was: ${recordedUrls[i]}`);
        }
        if (recordedHeaders[i]['auth-token'] !== 'test-mock-api-key') {
          throw new Error(`Request ${i} missing auth-token header`);
        }
      }
    });

    // -------------------------------------------------------------
    // TEST 4: Live Response Parsing & Non-reliance on Base Curve
    // -------------------------------------------------------------
    await assert('4. Parses live forecast directly and NEVER falls back to regional baseCurve', async () => {
      // Mock API returning arbitrary distinctive values completely different from baseCurve
      const mockLiveIntensities = [
        412, 408, 395, 380, 210, 115, 88, 92, 105, 140,
        185, 220, 270, 310, 350, 390, 425, 450, 470, 460,
        430, 410, 390, 380
      ];

      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          forecast: mockLiveIntensities.map((val, i) => ({
            datetime: new Date(HOUR0 + i * 3600000).toISOString(),
            carbonIntensity: val,
          })),
        }),
      });

      const testProvider = new ElectricityMapsDataProvider('test-valid-key');
      const forecast = await testProvider.getForecast('US-CAL-CISO', 24);

      if (forecast.dataMode !== 'live') {
        throw new Error(`Expected dataMode 'live', got ${forecast.dataMode}`);
      }
      if (forecast.hourlyProfile.length !== 24) {
        throw new Error(`Expected 24 points, got ${forecast.hourlyProfile.length}`);
      }

      // Check values match mockLiveIntensities exactly, NOT baseCurve
      const calisoBaseCurve = REGIONAL_PROFILES['US-CAL-CISO'].baseCurve;
      for (let i = 0; i < 24; i++) {
        const actual = forecast.hourlyProfile[i].predictedCarbon;
        const expected = mockLiveIntensities[i];
        const baseVal = calisoBaseCurve[i];

        if (actual !== expected) {
          throw new Error(`Hour ${i}: expected live value ${expected}, got ${actual}`);
        }
      }

      // Confirm hour 0 is 412, not baseCurve's 310
      if (forecast.hourlyProfile[0].predictedCarbon === calisoBaseCurve[0]) {
        throw new Error(`Hour 0 unexpectedly matched baseCurve value (${calisoBaseCurve[0]})`);
      }
    });

    // -------------------------------------------------------------
    // TEST 5: Scheduler Consumes Actual Live Forecast Values
    // -------------------------------------------------------------
    await assert('5. All 5 scheduling policies consume actual live forecast values and metrics', async () => {
      // Mock live forecast where hour 6-7 is the cleanest window (e.g. 75 gCO2eq/kWh)
      const mockIntensities = Array(24).fill(300);
      mockIntensities[6] = 75;
      mockIntensities[7] = 85;

      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          forecast: mockIntensities.map((val, i) => ({
            datetime: new Date(HOUR0 + i * 3600000).toISOString(),
            carbonIntensity: val,
          })),
        }),
      });

      const testProvider = new ElectricityMapsDataProvider('test-valid-key');
      const liveForecast = await testProvider.getForecast('US-CAL-CISO', 24);

      const testJob = {
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
        riskTolerance: 0.10,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const result = evaluateAllPolicies(testJob, liveForecast, 1.0);

      // Verify all 5 policies were evaluated
      if (result.evaluatedPolicies.length !== 5) {
        throw new Error(`Expected 5 evaluated policies, got ${result.evaluatedPolicies.length}`);
      }

      // Check immediate policy uses hour 0-1 average (300 gCO2eq/kWh)
      const imm = result.evaluatedPolicies.find(p => p.policyId === 'immediate');
      if (imm.predictedCarbon !== 300 || imm.predictedCarbonIntensity !== 300) {
        throw new Error(`Expected immediate carbon 300, got ${imm.predictedCarbon}`);
      }

      // Check greedy / deterministic policy finds lowest window at T+6 (average of 75 and 85 = 80 gCO2eq/kWh)
      const det = result.evaluatedPolicies.find(p => p.policyId === 'deterministic_carbon');
      if (det.selectedStartHour !== 6 || det.predictedCarbon !== 80) {
        throw new Error(`Expected deterministic policy at T+6 with 80 gCO2eq/kWh, got T+${det.selectedStartHour} with ${det.predictedCarbon}`);
      }

      // Verify explicit units on all policies
      for (const pol of result.evaluatedPolicies) {
        if (pol.carbonIntensityUnit !== 'gCO2eq/kWh') {
          throw new Error(`Policy ${pol.policyId} missing or invalid carbonIntensityUnit: ${pol.carbonIntensityUnit}`);
        }
        if (pol.workloadEmissionsUnit !== 'gCO2eq') {
          throw new Error(`Policy ${pol.policyId} missing or invalid workloadEmissionsUnit: ${pol.workloadEmissionsUnit}`);
        }
        if (typeof pol.predictedCarbonIntensity !== 'number') {
          throw new Error(`Policy ${pol.policyId} missing predictedCarbonIntensity number`);
        }
        if (typeof pol.estimatedWorkloadEmissionsGrams !== 'number') {
          throw new Error(`Policy ${pol.policyId} missing estimatedWorkloadEmissionsGrams number`);
        }
      }
    });

    // -------------------------------------------------------------
    // TEST 6: Explicit Demo Mode Continues Working for Benchmarks
    // -------------------------------------------------------------
    await assert('6. Explicit demo mode (mode: "demo") returns benchmark trace independently of API key', async () => {
      delete process.env.ELECTRICITY_MAPS_API_KEY;

      const demoForecast = await CarbonService.getForecast('US-CAL-CISO', 24, 'demo');
      if (demoForecast.dataMode !== 'demo') {
        throw new Error(`Expected dataMode 'demo', got ${demoForecast.dataMode}`);
      }
      if (demoForecast.hourlyProfile.length !== 24) {
        throw new Error(`Expected 24 points, got ${demoForecast.hourlyProfile.length}`);
      }

      const expectedFirstPoint = REGIONAL_PROFILES['US-CAL-CISO'].baseCurve[0];
      if (demoForecast.hourlyProfile[0].predictedCarbon !== expectedFirstPoint) {
        throw new Error(`Expected calibrated baseCurve point ${expectedFirstPoint}, got ${demoForecast.hourlyProfile[0].predictedCarbon}`);
      }
    });

    // -------------------------------------------------------------
    // TEST 7: Error Handling for Network Failures & Bad Responses
    // -------------------------------------------------------------
    await assert('7. Propagates HTTP 401, HTTP 429, and network failures with explicit error messages', async () => {
      const testProvider = new ElectricityMapsDataProvider('invalid-or-ratelimited-key');

      // 7a. HTTP 401 Unauthorized
      global.fetch = async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      let threw401 = false;
      try {
        await testProvider.getForecast('US-CAL-CISO', 24);
      } catch (err) {
        threw401 = true;
        if (!err.message.includes('HTTP 401') || !err.message.includes('Live carbon forecast unavailable:')) {
          throw new Error(`Unexpected 401 error message: ${err.message}`);
        }
      }
      if (!threw401) throw new Error('Failed to throw on HTTP 401');

      // 7b. HTTP 429 Rate Limit
      global.fetch = async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      let threw429 = false;
      try {
        await testProvider.getForecast('US-CAL-CISO', 24);
      } catch (err) {
        threw429 = true;
        if (!err.message.includes('HTTP 429') || !err.message.includes('Live carbon forecast unavailable:')) {
          throw new Error(`Unexpected 429 error message: ${err.message}`);
        }
      }
      if (!threw429) throw new Error('Failed to throw on HTTP 429');

      // 7c. Network fetch exception
      global.fetch = async () => {
        throw new Error('ENOTFOUND api.electricitymap.org');
      };

      let threwNetwork = false;
      try {
        await testProvider.getForecast('US-CAL-CISO', 24);
      } catch (err) {
        threwNetwork = true;
        if (!err.message.includes('Network request failed') || !err.message.includes('Live carbon forecast unavailable:')) {
          throw new Error(`Unexpected network error message: ${err.message}`);
        }
      }
      if (!threwNetwork) throw new Error('Failed to throw on network error');

      // 7d. Empty forecast array
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ forecast: [] }),
      });

      let threwEmpty = false;
      try {
        await testProvider.getForecast('US-CAL-CISO', 24);
      } catch (err) {
        threwEmpty = true;
        if (!err.message.includes('empty forecast') || !err.message.includes('Live carbon forecast unavailable:')) {
          throw new Error(`Unexpected empty forecast error message: ${err.message}`);
        }
      }
      if (!threwEmpty) throw new Error('Failed to throw on empty forecast');
    });

  } finally {
    // Restore global fetch and env
    global.fetch = originalFetch;
    if (originalEnvKey !== undefined) {
      process.env.ELECTRICITY_MAPS_API_KEY = originalEnvKey;
    } else {
      delete process.env.ELECTRICITY_MAPS_API_KEY;
    }
  }

  console.log('\n========================================================');
  console.log(`🎯 Electricity Maps Live Provider Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runElectricityMapsTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

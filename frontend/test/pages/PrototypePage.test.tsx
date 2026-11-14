/**
 * Scheduling page against a stubbed backend (hand-written test data in the API's shape).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrototypePage } from '../../src/pages/PrototypePage';
import { API_BASE } from '../../src/services/api';
import { stubFetch, bodyOf } from '../support/fetch';

const zones = [
  { code: 'DE', name: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' },
  { code: 'IN-NO', name: 'Northern India', countryName: 'India', countryCode: 'IN', timezone: 'Asia/Kolkata' },
  { code: 'US-CAL-CISO', name: 'California ISO', countryName: 'USA', timezone: 'America/Los_Angeles' },
];

// P11: the selector reads the global zone catalogue (hand-written test data in the API's shape).
const catalogueZone = (zone: string, name: string, countryName: string | null, continent: string, area: string, timezone: string, demo = false) => ({
  zone, name, zoneName: name, countryCode: zone.slice(0, 2), countryName, continent, area, timezone, timezoneSource: 'test',
  parentZone: null, subZones: [], aggregate: false, tier: 'TIER_A', commerciallyAvailable: true,
  providerListed: { latest: true, history: true, forecast: true }, verifiedLive: null, syntheticDemo: demo, flags: [],
});
const catalogue = (liveConfigured: boolean) => ({
  meta: { version: '2026-11-14', zones: 3, sources: {}, counts: {} },
  liveConfigured,
  zones: [
    catalogueZone('DE', 'Germany', 'Germany', 'Europe', 'Western Europe', 'Europe/Berlin', true),
    catalogueZone('IN-NO', 'Northern India', 'India', 'Asia', 'Southern Asia', 'Asia/Kolkata', true),
    catalogueZone('US-CAL-CISO', 'California ISO', 'USA', 'Americas', 'Northern America', 'America/Los_Angeles', true),
  ],
});

const liveForecast = {
  source: 'Electricity Maps API',
  region: 'US-CAL-CISO',
  regionName: 'US-CAL-CISO',
  timestamp: '2026-11-12T19:00:00.000Z',
  dataMode: 'live',
  dataClass: 'real',
  uncertaintySource: 'unavailable',
  timezone: 'America/Los_Angeles',
  traceVersion: 'electricitymaps-v3',
  forecastHorizonHours: 24,
  timeResolution: '60 minutes',
  hourlyProfile: [0, 1, 2].map((h) => ({ hour: h, timestamp: new Date(Date.UTC(2026, 10, 12, 19 + h)).toISOString(), predictedCarbon: 100 + h, stdDev: null })),
  averageCarbon: 101,
  minCarbon: 100,
  maxCarbon: 102,
  snapshot: {
    provider: 'electricitymaps', dataClass: 'real', zone: 'US-CAL-CISO', issuedAt: '2026-11-12T18:58:56.219Z', fetchedAt: '2026-11-12T19:00:00.000Z',
    horizonHours: 24, granularity: 'hourly', emissionFactorType: 'lifecycle', unit: 'gCO2eq/kWh', points: [], endpoint: '/carbon-intensity/forecast', rawSha256: null,
  },
};

function backend(scheduleData: unknown, providerConfigured = true) {
  return stubFetch((url, init) => {
    if (url === `${API_BASE}/carbon/catalogue`) return { body: { success: true, data: catalogue(providerConfigured) } };
    if (url === `${API_BASE}/carbon/provider`) return { body: { success: true, configured: providerConfigured, historyWindowHours: 24, pastRangeAvailable: false, data: { configured: providerConfigured, historyWindowHours: 24, pastRangeAvailable: false } } };
    if (url.startsWith(`${API_BASE}/carbon/regions`)) return { body: { success: true, source: 'electricitymaps', data: zones } };
    if (url.startsWith(`${API_BASE}/carbon/forecast`)) return { body: { success: true, data: liveForecast } };
    if (url.startsWith(`${API_BASE}/cluster/health`)) return { body: { success: true, data: { isAvailable: false, message: 'offline' } } };
    if (url === `${API_BASE}/schedule` && init?.method === 'POST') return { body: { success: true, data: scheduleData } };
    return undefined;
  });
}

/** Scheduling runs only on request (P9): press the button once the zones have loaded. */
async function evaluate() {
  await screen.findByRole("option", { name: /DE — Germany/ });
  fireEvent.click(screen.getByRole("button", { name: /Evaluate 5 Schedulers/ }));
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <PrototypePage />
    </MemoryRouter>
  );

// Live data needs a signed-in user (the backend answers 401 otherwise).
beforeEach(() => localStorage.setItem("carbonroute_token", "test-token"));

describe("PrototypePage: which data source it starts with (P9, public staging)", () => {
  it("signed out: starts on the labelled demo trace and makes no live request", async () => {
    localStorage.removeItem("carbonroute_token");
    const fetchMock = backend({ status: "INFEASIBLE", reason: "x", recommendation: null });
    renderPage();
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("mode=demo"))).toBe(true));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("mode=live"))).toBe(false);
    expect((screen.getByLabelText(/Data source|Carbon Data Source/i, { selector: "select" }) as HTMLSelectElement).value).toBe("demo");
  });

  it("signed in but no provider key on the server: starts on the demo trace", async () => {
    const fetchMock = backend({ status: "INFEASIBLE", reason: "x", recommendation: null }, false);
    renderPage();
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("mode=demo"))).toBe(true));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("mode=live"))).toBe(false);
  });
});

describe('PrototypePage (M5 real-data workflow)', () => {
  it('lists zones from the backend and labels the live forecast as real with no invented uncertainty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    backend({ status: 'INFEASIBLE', reason: 'too late', recommendation: null });
    renderPage();
    await waitFor(() => expect(screen.getByRole('option', { name: /IN-NO — Northern India \(India\)/ })).toBeInTheDocument());
    expect(screen.getByTestId('zone-count')).toHaveTextContent('Showing 3 of 3 zones');
    expect(await screen.findByText('REAL FORECAST · ELECTRICITY MAPS')).toBeInTheDocument();
    expect(screen.getByText(/The provider gives no forecast uncertainty/)).toBeInTheDocument();
  });

  // P9 regression: opening the page used to schedule a job at once (a stored job the user never
  // submitted, and live provider calls on every visit).
  it("does not schedule anything until the user presses Evaluate", async () => {
    const fetchMock = backend({ status: "INFEASIBLE", reason: "x", recommendation: null });
    renderPage();
    await screen.findByRole("option", { name: /DE — Germany/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === `${API_BASE}/schedule`)).toBe(false);
    expect(screen.getByTestId("evaluate-hint")).toHaveTextContent(/nothing is scheduled until you press it/);
    fireEvent.click(screen.getByRole("button", { name: /Evaluate 5 Schedulers/ }));
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]) === `${API_BASE}/schedule`)).toHaveLength(1));
    expect(screen.queryByTestId("evaluate-hint")).toBeNull();
  });

  it('filters the zone list by search text', async () => {
    backend({ status: 'INFEASIBLE', reason: 'x', recommendation: null });
    renderPage();
    await screen.findByRole('option', { name: /DE — Germany/ });
    fireEvent.change(screen.getByLabelText('Search grid zones'), { target: { value: 'india' } });
    await waitFor(() => expect(screen.queryByRole('option', { name: /DE — Germany/ })).toBeNull());
  });

  it('sends an absolute UTC deadline and shows an explicit infeasible result instead of a recommendation', async () => {
    const fetchMock = backend({ status: 'INFEASIBLE', reason: 'A 2 h job cannot finish before the deadline.', recommendation: null });
    renderPage();
    await evaluate();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No feasible execution window');
    expect(alert).toHaveTextContent('A 2 h job cannot finish before the deadline.');
    const scheduleCall = fetchMock.mock.calls.find((c) => String(c[0]) === `${API_BASE}/schedule`)!;
    const sent = bodyOf(scheduleCall);
    expect(sent.mode).toBe('live');
    expect(Date.parse(sent.jobData.deadlineAt)).toBeGreaterThan(Date.now());
    expect(sent.jobData.deadlineAt).toMatch(/Z$/);
    expect(screen.queryByText('CarbonRoute Recommendation')).toBeNull();
  });

  // P6 audit: the page never sent a runtime CV, so every decision from the UI was deterministic.
  it('sends the declared runtime variability (0 by default, the selected value after a change)', async () => {
    const fetchMock = backend({ status: 'INFEASIBLE', reason: 'too late', recommendation: null });
    renderPage();
    await evaluate();
    await screen.findByRole('alert');
    const calls = () => fetchMock.mock.calls.filter((c) => String(c[0]) === `${API_BASE}/schedule`);
    expect(bodyOf(calls()[0]).runtimeCv).toBe(0);
    fireEvent.change(screen.getByLabelText('Runtime variability (CV)'), { target: { value: '0.2' } });
    fireEvent.click(screen.getByRole('button', { name: /Evaluate 5 Schedulers/ }));
    await waitFor(() => expect(calls().length).toBe(2));
    expect(bodyOf(calls()[1]).runtimeCv).toBe(0.2);
  });

  // Regression (defect 1, dashboard): the recommendation card uses the time-weighted forecast
  // (demo job-7f42a910: recommended 117 vs Immediate 117.33 -> 0.28%), not the engine's
  // hourly-slot saving (1.7%).
  it('shows the time-weighted forecast and saving on the recommendation card', async () => {
    const policy = (policyId: string, policyName: string, start: string, end: string, slot: number, category = 'Baseline') => ({
      policyId, policyName, category, selectedStartHour: 0, selectedWindow: 'T+0:00 to T+1:00', predictedCarbon: slot, predictedCarbonIntensity: slot,
      estimatedDeadlineRisk: 0, waitingTimeHours: 0, isFeasible: true, schedulerOverheadMs: 0, rationale: 'r',
      selectedStartUtc: start, selectedEndUtc: end, meetsDeadline: true,
    });
    const imm = policy('immediate', 'Immediate Execution', '2026-11-12T19:49:57.531Z', '2026-11-12T20:49:57.531Z', 119);
    const rec = policy('carbonroute_uncertainty', 'CarbonRoute Uncertainty-Aware', '2026-11-12T20:00:00.000Z', '2026-11-12T21:00:00.000Z', 117, 'Uncertainty-Aware');
    backend({
      status: 'RECOMMENDED',
      job: { id: 'job-7f42a910', name: 'demo', region: 'US-CAL-CISO', durationHours: 1, deadlineHours: 2, arrivalHour: 0, cpu: 2, memoryMb: 1024, riskTolerance: 0.05, commandOrImage: 'x', isContainerImage: true, createdAt: '' },
      carbonSource: 'Electricity Maps API',
      dataMode: 'live',
      region: 'US-CAL-CISO',
      candidateWindows: [],
      evaluatedPolicies: [imm, { ...imm, policyId: 'edf', policyName: 'EDF' }, { ...rec, policyId: 'deterministic_carbon', policyName: 'Deterministic' }, { ...imm, policyId: 'carbon_aware_baseline', policyName: 'Baseline' }, rec],
      recommendedDecision: rec,
      comparisonSummary: { carbonSavingsVsImmediatePct: 1.7, delayPenaltyHours: 0, riskDifferenceVsDeterministic: 0 },
      riskModel: 'deterministic-no-uncertainty-data',
      recommendedWindow: { startUtc: '2026-11-12T20:00:00.000Z', endUtc: '2026-11-12T21:00:00.000Z' },
      timeline: { arrivalAt: '2026-11-12T19:49:57.531Z', deadlineAt: '2026-11-12T21:49:57.000Z', forecastStartUtc: '2026-11-12T19:00:00.000Z', forecastCoverageEndUtc: '2026-11-13T02:00:00.000Z', deadlineBeyondForecast: false, timezone: 'America/Los_Angeles', note: '' },
      timeWeightedForecast: { recommendedIntensity: 117, immediateIntensity: 117.33, savingsVsImmediatePct: 0.28, basis: 'time-weighted' },
    });
    renderPage();
    await evaluate();
    expect(await screen.findByText('CarbonRoute Recommendation')).toBeInTheDocument();
    expect(screen.getByText(/Forecast: 0.28% vs Immediate \(time-weighted; predicted, not observed\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Forecast: 1.7% vs Immediate/)).toBeNull();
  });
});

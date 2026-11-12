/**
 * Scheduling page against a stubbed backend (hand-written test data in the API's shape).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
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

function backend(scheduleData: unknown) {
  return stubFetch((url, init) => {
    if (url.startsWith(`${API_BASE}/carbon/regions`)) return { body: { success: true, source: 'electricitymaps', data: zones } };
    if (url.startsWith(`${API_BASE}/carbon/forecast`)) return { body: { success: true, data: liveForecast } };
    if (url.startsWith(`${API_BASE}/cluster/health`)) return { body: { success: true, data: { isAvailable: false, message: 'offline' } } };
    if (url === `${API_BASE}/schedule` && init?.method === 'POST') return { body: { success: true, data: scheduleData } };
    return undefined;
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <PrototypePage />
    </MemoryRouter>
  );

describe('PrototypePage (M5 real-data workflow)', () => {
  it('lists zones from the backend and labels the live forecast as real with no invented uncertainty', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    backend({ status: 'INFEASIBLE', reason: 'too late', recommendation: null });
    renderPage();
    await waitFor(() => expect(screen.getByRole('option', { name: /IN-NO — Northern India \(India\)/ })).toBeInTheDocument());
    expect(screen.getByText(/3 zones available from Electricity Maps/)).toBeInTheDocument();
    expect(await screen.findByText('REAL FORECAST · ELECTRICITY MAPS')).toBeInTheDocument();
    expect(screen.getByText(/The provider gives no forecast uncertainty/)).toBeInTheDocument();
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
});

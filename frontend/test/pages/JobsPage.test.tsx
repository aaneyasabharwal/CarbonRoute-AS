/**
 * My jobs page against a stubbed backend (hand-written data in the API's response shape).
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { JobsPage } from '../../src/pages/JobsPage';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

const summary = {
  id: 'job-abc12345',
  name: 'Nightly ETL',
  zone: 'DE',
  createdAt: '2026-11-13T10:00:00.000Z',
  status: 'scheduled',
  ownerId: 'u1',
  latestDecision: { id: 'dec-1', status: 'RECOMMENDED', createdAt: '2026-11-13T10:00:01.000Z', dataMode: 'live', recommendedWindow: { startUtc: '2026-11-13T14:00:00.000Z', endUtc: '2026-11-13T16:00:00.000Z' } },
  cancelledAt: null,
};

const policy = (policyId: string, policyName: string, extra: Record<string, unknown> = {}) => ({
  policyId,
  policyName,
  category: 'Baseline',
  selectedStartUtc: '2026-11-13T10:00:00.000Z',
  selectedEndUtc: '2026-11-13T12:00:00.000Z',
  selectedWindow: 'T+0:00 to T+2:00',
  forecastIntensity: 250,
  estimatedEmissionsAssumedEnergyGrams: 125,
  estimatedDeadlineRisk: 0,
  waitingTimeHours: 0,
  isFeasible: true,
  equivalentTo: null,
  recommended: false,
  ...extra,
});

const details = {
  ...summary,
  job: {},
  decision: {
    id: 'dec-1',
    status: 'RECOMMENDED',
    createdAt: '2026-11-13T10:00:01.000Z',
    engineVersion: 'carbonroute-engine-2026-11-p1',
    dataMode: 'live',
    dataClass: 'real',
    snapshotId: 'snap-1',
    recommendedWindow: { startUtc: '2026-11-13T14:00:00.000Z', endUtc: '2026-11-13T16:00:00.000Z' },
    immediateWindow: null,
    infeasibilityReason: null,
    riskModel: 'deterministic',
    runtimeCv: 0,
    provenance: { provider: 'electricitymaps', dataClass: 'real', zone: 'DE', fetchedAt: '2026-11-13T10:00:00.000Z', issuedAt: null },
    energyAssumption: { powerKw: 0.25, energyKwh: 0.5, basis: 'Prototype assumption: 0.125 kW per requested vCPU (minimum 0.1 kW). Not measured.' },
    explanation: {
      objective: 'Minimise forecast carbon intensity of the run window, subject to the deadline and the deadline-miss risk tolerance.',
      constraints: [{ name: 'Deadline', value: 'the window must end by slot T+8 (2 h job)' }],
      candidates: { total: 7, feasible: 7, rejectedHighRisk: 0, rejectedDataGap: 0 },
      bindingConstraint: 'none',
      summary: 'T+4:00 to T+6:00 has the lowest forecast intensity (100 gCO2eq/kWh) of the 7 windows.',
      policies: [{ policyId: 'edf', relation: 'Same window as immediate (single job).' }],
      unavailable: [{ policyId: 'oracle', policyName: 'Oracle (hindsight)', reason: 'Offline evaluation only.' }],
    },
    policies: [
      policy('immediate', 'Immediate Execution'),
      policy('edf', 'Earliest Deadline First (EDF)', { equivalentTo: 'immediate' }),
      policy('carbonroute_uncertainty', 'CarbonRoute (risk-constrained)', { forecastIntensity: 100, recommended: true, selectedStartUtc: '2026-11-13T14:00:00.000Z', selectedEndUtc: '2026-11-13T16:00:00.000Z' }),
    ],
    unavailablePolicies: [{ policyId: 'oracle', policyName: 'Oracle (hindsight)', reason: 'Offline evaluation only.' }],
    candidateCount: 7,
  },
  execution: null,
  observations: { status: 'COMPLETE', statusDetail: 'All intervals observed.', collectedAt: '2026-11-13T17:00:00.000Z', intervals: 2, measured: 1, providerEstimate: 1, missing: 0, attempts: 1 },
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <JobsPage />
    </MemoryRouter>
  );

beforeEach(() => localStorage.removeItem('carbonroute_token'));

describe('JobsPage', () => {
  it('asks for sign-in without calling the backend when there is no session', () => {
    const fetchMock = stubFetch(() => undefined);
    renderPage();
    expect(screen.getByTestId('sign-in-required')).toHaveTextContent('Sign in to see your jobs');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows an empty state when the user has no jobs', async () => {
    localStorage.setItem('carbonroute_token', 't');
    stubFetch((url) => (url === `${API_BASE}/jobs` ? { body: { success: true, data: [] } } : undefined));
    renderPage();
    expect(await screen.findByText('No jobs yet')).toBeInTheDocument();
    expect(screen.getByText('Prototype').closest('a')).toHaveAttribute('href', '/prototype');
  });

  it('shows the backend error with a retry, and never invented jobs', async () => {
    localStorage.setItem('carbonroute_token', 't');
    let calls = 0;
    stubFetch(() => {
      calls++;
      return { status: 500, body: { success: false, message: 'Database unavailable' } };
    });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.queryByText('Nightly ETL')).toBeNull();
  });

  it('a rejected session (401) asks the user to sign in again', async () => {
    localStorage.setItem('carbonroute_token', 'expired');
    stubFetch(() => ({ status: 401, body: { success: false, code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' } }));
    renderPage();
    expect(await screen.findByTestId('sign-in-required')).toHaveTextContent('Your session has expired');
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });

  it('lists jobs and shows the explanation, policy comparison, data-quality badges and offline Oracle', async () => {
    localStorage.setItem('carbonroute_token', 't');
    const fetchMock = stubFetch((url, init) => {
      if (url === `${API_BASE}/jobs`) return { body: { success: true, data: [summary] } };
      if (url === `${API_BASE}/jobs/job-abc12345`) return { body: { success: true, data: details } };
      if (url === `${API_BASE}/jobs/job-abc12345/oracle`) return { body: { success: true, data: { status: 'UNAVAILABLE_INCOMPLETE_COVERAGE', offlineOnly: true, basis: 'Only 2 of 7 candidate windows have complete realized observations.', policies: [] } } };
      if (url === `${API_BASE}/jobs/job-abc12345/cancel` && init?.method === 'POST') return { body: { success: true, data: { ...summary, status: 'cancelled' } } };
      return undefined;
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nightly ETL/ }));

    expect(await screen.findByTestId('decision-explanation')).toHaveTextContent('lowest forecast intensity (100 gCO2eq/kWh)');
    const table = screen.getByRole('table', { name: 'Policy comparison' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('RECOMMENDED');
    expect(rows[1]).toHaveTextContent('same as immediate (single job)');
    expect(within(table).queryByText(/Oracle/)).toBeNull(); // the Oracle is not a policy

    const obs = screen.getByRole('region', { name: 'Observations' });
    expect(obs.querySelector('[data-quality="measured"]')).toHaveTextContent('Measured 1');
    expect(obs.querySelector('[data-quality="provider-estimate"]')).toHaveTextContent('Provider estimate 1');

    fireEvent.click(screen.getByRole('button', { name: 'Run hindsight evaluation' }));
    expect(await screen.findByTestId('oracle-result')).toHaveTextContent('UNAVAILABLE INCOMPLETE COVERAGE');
    expect(screen.getByRole('region', { name: 'Hindsight evaluation' })).toHaveTextContent('offline only');

    fireEvent.click(screen.getByRole('button', { name: /Cancel job/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/cancel'))).toBe(true));
    for (const c of fetchMock.mock.calls) expect(new Headers((c[1] as RequestInit | undefined)?.headers).get('Authorization')).toBe('Bearer t');
  });
});

describe('JobsPage observations (P4 review)', () => {
  it('collects observations for any listed job from this page, instead of pointing to the Prototype page', async () => {
    localStorage.setItem('carbonroute_token', 't');
    let collected = false;
    const fetchMock = stubFetch((url, init) => {
      if (url === `${API_BASE}/jobs`) return { body: { success: true, data: [summary] } };
      if (url === `${API_BASE}/jobs/job-abc12345`) return { body: { success: true, data: { ...details, observations: collected ? details.observations : null } } };
      if (url === `${API_BASE}/jobs/job-abc12345/observations` && init?.method === 'POST') {
        collected = true;
        return { body: { success: true, data: { collected: { status: 'COMPLETE' } } } };
      }
      return undefined;
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nightly ETL/ }));
    const obs = await screen.findByRole('region', { name: 'Observations' });
    expect(obs).toHaveTextContent('Values exist only after the scheduled window has ended');
    expect(obs).not.toHaveTextContent('Prototype page');
    fireEvent.click(within(obs).getByRole('button', { name: 'Collect observations' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Observations' }).querySelector('[data-quality="measured"]')).toHaveTextContent('Measured 1'));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/observations') && (c[1] as RequestInit)?.method === 'POST')).toBe(true);
  });

  it('a failed collection is shown as an error, not as data', async () => {
    localStorage.setItem('carbonroute_token', 't');
    stubFetch((url, init) => {
      if (url === `${API_BASE}/jobs`) return { body: { success: true, data: [summary] } };
      if (url === `${API_BASE}/jobs/job-abc12345`) return { body: { success: true, data: { ...details, observations: null } } };
      if (url.endsWith('/observations') && init?.method === 'POST') return { status: 503, body: { success: false, message: 'Electricity Maps did not respond' } };
      return undefined;
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nightly ETL/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Collect observations' }));
    expect(await screen.findByText('Electricity Maps did not respond')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Observations' }).querySelector('[data-quality="measured"]')).toBeNull();
  });
});

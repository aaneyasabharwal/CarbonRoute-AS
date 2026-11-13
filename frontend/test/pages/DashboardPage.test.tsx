/**
 * Dashboard (P8): replaces the former placeholder page. All values come from the (stubbed) backend in
 * the API's response shape; failures show errors, never invented numbers.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage, readDifference } from '../../src/pages/DashboardPage';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

const ci = (estimate: number, low: number, high: number) => ({ n: 600, estimate, low, high, level: 0.95, method: 'percentile-bootstrap', iterations: 2000, seed: 1, clusters: 58 });
const benchmark = {
  id: 'benchmark-2026-11-13T23-48-22-308Z',
  createdAt: '2026-11-13T23:48:22.308Z',
  gitCommit: 'abc',
  dataClass: 'real-carbon-data-synthetic-workloads',
  configSha256: 'cfg',
  seed: 42,
  workloadsPerSnapshot: 20,
  dataset: { zones: ['DE'], snapshots: 60, realizedIntervals: 170, measuredShare: 0.612, sha256: 'd', files: [] },
  scenarios: [
    { runtimeCv: 0, workloads: 1200, infeasible: 0, pendingRealized: 528, oracleAvailable: 412, policies: [{ policyId: 'carbonroute_uncertainty', deadlineViolationRate: 0, diffVsImmediateClusterCI: ci(-8.06, -17.61, -0.05) }] },
    { runtimeCv: 0.2, workloads: 1200, infeasible: 110, pendingRealized: 528, oracleAvailable: 412, policies: [{ policyId: 'carbonroute_uncertainty', deadlineViolationRate: 0.009, diffVsImmediateClusterCI: ci(-7.21, -17.39, 0.4) }] },
  ],
  notes: [],
};
const provider = { configured: true, historyWindowHours: 24, pastRangeAvailable: false, callBudget: { lastHour: 3, lastDay: 40, maxPerHour: 120, maxPerDay: 1500 } };
const jobs = [
  { id: 'job-1', name: 'Nightly ETL', zone: 'DE', createdAt: '2026-11-13T10:00:00Z', status: 'completed', ownerId: 'u', latestDecision: { id: 'd', status: 'RECOMMENDED', createdAt: 'x', dataMode: 'live', recommendedWindow: null }, cancelledAt: null },
  { id: 'job-2', name: 'Demo job', zone: 'BENCHMARK-RESEARCH', createdAt: '2026-11-13T11:00:00Z', status: 'scheduled', ownerId: 'u', latestDecision: { id: 'e', status: 'RECOMMENDED', createdAt: 'x', dataMode: 'demo', recommendedWindow: null }, cancelledAt: null },
  { id: 'job-3', name: 'Too late', zone: 'DE', createdAt: '2026-11-13T09:00:00Z', status: 'infeasible', ownerId: 'u', latestDecision: null, cancelledAt: null },
];

function backend(over: Record<string, any> = {}) {
  return stubFetch((url) => {
    if (url in over) return over[url];
    if (url === `${API_BASE}/carbon/provider`) return { body: { success: true, data: provider } };
    if (url === `${API_BASE}/cluster/health`) return { body: { success: true, data: { isAvailable: false, message: 'No Kubernetes cluster is reachable; dispatched jobs are simulated (no workload process is run).' } } };
    if (url === `${API_BASE}/jobs`) return { body: { success: true, data: jobs } };
    if (url === `${API_BASE}/results/benchmarks`) return { body: { success: true, data: [benchmark] } };
    if (url === `${API_BASE}/results/benchmarks/${benchmark.id}`) return { body: { success: true, data: benchmark } };
    if (url === `${API_BASE}/results/ml`) return { body: { success: true, data: [{ id: 'ml-1', createdAt: 'x', status: 'insufficient-data', dataset: { rows: 350, measuredRows: 175, zones: ['DE'], spanDays: 0.4 } }] } };
    return undefined;
  });
}
const renderPage = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>);

beforeEach(() => localStorage.removeItem('carbonroute_token'));

describe('readDifference', () => {
  it('uses the same rule as the research report', () => {
    expect(readDifference({ estimate: -7, low: -17, high: 0.4 })).toBe('no evidence of a difference');
    expect(readDifference({ estimate: -8, low: -17, high: -0.05 })).toBe('lower than Immediate in this sample');
    expect(readDifference({ estimate: 2, low: 1, high: 3 })).toBe('higher than Immediate in this sample');
    expect(readDifference({ estimate: -1, low: null, high: null })).toMatch(/no interval/);
  });
});

describe('DashboardPage', () => {
  it('signed out: shows public platform status, asks to sign in for jobs and results, and never requests them', async () => {
    const fetchMock = backend();
    renderPage();
    expect(await screen.findByTestId('provider-status')).toHaveTextContent('configured');
    expect(screen.getByTestId('provider-status')).toHaveTextContent('3/120 this hour');
    expect(await screen.findByTestId('execution-mode')).toHaveTextContent('Simulated');
    expect(screen.getByTestId('sign-in-required')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/jobs') || String(c[0]).includes('/results'))).toBe(false);
  });

  it('signed in: job counts, recent jobs (synthetic labelled), benchmark reading per runtime CV and model status', async () => {
    localStorage.setItem('carbonroute_token', 't');
    backend();
    renderPage();
    const summary = await screen.findByTestId('jobs-summary');
    expect(summary).toHaveTextContent('3 total');
    expect(summary).toHaveTextContent('completed 1');
    expect(summary).toHaveTextContent('infeasible 1');
    expect(summary).toHaveTextContent('Demo job');
    expect(summary).toHaveTextContent('synthetic');

    const table = await screen.findByRole('table', { name: 'CarbonRoute vs Immediate' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('lower than Immediate in this sample');
    expect(rows[1]).toHaveTextContent('-7.21 [-17.39, 0.40]');
    expect(rows[1]).toHaveTextContent('no evidence of a difference');
    expect(rows[1]).toHaveTextContent('0.9%');

    expect(await screen.findByTestId('ml-status')).toHaveTextContent('Not trained: not enough data yet');
    expect(screen.getByTestId('ml-status')).not.toHaveTextContent(/MAE|accuracy/i);
  });

  it('a failing section shows its error and no numbers; others still load', async () => {
    localStorage.setItem('carbonroute_token', 't');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    backend({ [`${API_BASE}/results/benchmarks`]: { status: 503, body: { success: false, message: 'Results folder unreadable' } } });
    renderPage();
    const section = await screen.findByRole('region', { name: 'Latest benchmark' });
    expect(await within(section).findByRole('alert')).toHaveTextContent('Results folder unreadable');
    expect(within(section).queryByRole('table')).toBeNull();
    expect(await screen.findByTestId('jobs-summary')).toHaveTextContent('3 total');
  });

  it('no jobs: an empty state with a way to schedule one', async () => {
    localStorage.setItem('carbonroute_token', 't');
    backend({ [`${API_BASE}/jobs`]: { body: { success: true, data: [] } } });
    renderPage();
    const region = await screen.findByRole('region', { name: 'My jobs summary' });
    expect(await within(region).findByTestId('empty-state')).toHaveTextContent('No jobs yet');
  });
});

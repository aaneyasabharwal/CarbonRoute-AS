/**
 * Experiment results page against a stubbed backend (hand-written data in the API's shape).
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResultsPage } from '../../src/pages/ResultsPage';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

const item = {
  id: 'benchmark-2026-11-14T10-00-00-000Z',
  createdAt: '2026-11-14T10:00:00.000Z',
  gitCommit: 'abc1234',
  dataClass: 'real-carbon-data-synthetic-workloads',
  dataset: { zones: ['DE', 'GB'], snapshots: 20, realizedIntervals: 96, measuredShare: 0.4 },
  seed: 42,
  workloadsPerSnapshot: 20,
  scenarios: [{ runtimeCv: 0, workloads: 400, pendingRealized: 50 }],
};
const ci = (estimate: number | null, low: number | null, high: number | null, n: number, note?: string) => ({ n, estimate, low, high, level: 0.95, method: 'percentile-bootstrap', iterations: 2000, seed: 1, ...(note ? { note } : {}) });
const detail = {
  ...item,
  configSha256: 'c'.repeat(64),
  dataset: { ...item.dataset, sha256: 'd'.repeat(64), files: [] },
  scenarios: [
    {
      runtimeCv: 0,
      workloads: 400,
      infeasible: 0,
      pendingRealized: 50,
      oracleAvailable: 120,
      policies: [
        { policyId: 'immediate', decisions: 400, scored: 350, meanRealizedIntensity: 300.5, meanForecastIntensity: 298, meanEstimatedEmissionsGrams: 150.2, meanDelayHours: 0, deadlineViolationRate: 0, meanRegretVsOracle: 40.1, realizedIntensityCI: ci(300.5, 290.1, 311.2, 350), diffVsImmediateCI: ci(0, 0, 0, 350) },
        { policyId: 'carbonroute_uncertainty', decisions: 400, scored: 340, meanRealizedIntensity: 270.25, meanForecastIntensity: 265, meanEstimatedEmissionsGrams: 135.1, meanDelayHours: 3.2, deadlineViolationRate: 0, meanRegretVsOracle: 9.8, realizedIntensityCI: ci(270.25, 260, 280.5, 340), diffVsImmediateCI: ci(-30.1, -35.2, -25, 340) },
        { policyId: 'deterministic_carbon', decisions: 400, scored: 1, meanRealizedIntensity: 250, meanForecastIntensity: 250, meanEstimatedEmissionsGrams: 125, meanDelayHours: 5, deadlineViolationRate: 0, meanRegretVsOracle: null, realizedIntensityCI: ci(250, null, null, 1, 'Fewer than 2 values: no interval.'), diffVsImmediateCI: ci(null, null, null, 0) },
      ],
    },
  ],
  accuracy: {
    zones: [{ zone: 'GB', snapshots: 10, pairs: 100, all: { n: 100, mae: 30.5, rmse: 40.2, bias: -5.1 }, measuredOnly: { n: 0, mae: null, rmse: null, bias: null }, estimatedOnly: { n: 100, mae: 30.5, rmse: 40.2, bias: -5.1 } }],
    overall: { n: 100, mae: 30.5, rmse: 40.2, bias: -5.1 },
    measuredOnly: { n: 0, mae: null, rmse: null, bias: null },
  },
  notes: ['Workloads are synthetic (seeded); carbon forecasts and realized values are real Electricity Maps data.'],
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ResultsPage />
    </MemoryRouter>
  );

beforeEach(() => localStorage.removeItem('carbonroute_token'));

describe('ResultsPage', () => {
  it('requires sign-in', () => {
    stubFetch(() => undefined);
    renderPage();
    expect(screen.getByTestId('sign-in-required')).toHaveTextContent('experiment results');
  });

  it('explains how to produce results when none exist', async () => {
    localStorage.setItem('carbonroute_token', 't');
    stubFetch(() => ({ body: { success: true, data: [] } }));
    renderPage();
    // Both sections (benchmarks and the ML model) explain how to produce their results.
    const empties = await screen.findAllByTestId('empty-state');
    expect(empties.map((e) => e.textContent).join(' | ')).toMatch(/npm run benchmark.*|.*npm run ml/);
  });

  it('shows the backend error instead of numbers', async () => {
    localStorage.setItem('carbonroute_token', 't');
    stubFetch(() => ({ status: 503, body: { success: false, message: 'Results folder unreadable' } }));
    renderPage();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent!.includes('Results folder unreadable'))).toBe(true);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders policy comparison with intervals, pending counts, data labels and accuracy split by realized quality', async () => {
    localStorage.setItem('carbonroute_token', 't');
    stubFetch((url) => {
      if (url === `${API_BASE}/results/benchmarks`) return { body: { success: true, data: [item] } };
      if (url === `${API_BASE}/results/benchmarks/${item.id}`) return { body: { success: true, data: detail } };
      return undefined;
    });
    renderPage();
    const run = await screen.findByTestId('benchmark-run');
    expect(run).toHaveTextContent('40.0% measured (the rest are provider estimates)');
    expect(run.querySelector('[data-quality="synthetic"]')).toHaveTextContent('Synthetic workloads');
    // P4 review: pending counts workloads with ANY unobserved policy window; it must not claim they are unscored.
    expect(run).toHaveTextContent('50 with at least one policy window not yet fully observed (those windows are not scored; see Scored / decisions per policy)');
    expect(run).not.toHaveTextContent('not yet fully observed (not scored)');
    expect(run).toHaveTextContent('offline evaluation only');

    const table = screen.getByRole('table', { name: 'Policy comparison CV 0' });
    const [, imm, cr, greedy] = within(table).getAllByRole('row');
    expect(cr).toHaveTextContent('CarbonRoute (risk-constrained)');
    expect(cr).toHaveTextContent('-30.10 [-35.20, -25.00] (n=340)');
    expect(imm).toHaveTextContent('350 / 400');
    expect(greedy).toHaveTextContent('250.00 no interval'); // one value: no interval is shown, none is invented

    const acc = screen.getByRole('table', { name: 'Forecast accuracy' });
    expect(within(acc).getAllByRole('row')[1]).toHaveTextContent('n/a (0)'); // GB has no measured values
  });
});

describe('ResultsPage session handling', () => {
  it('keeps the server reason when the session is rejected', async () => {
    localStorage.setItem('carbonroute_token', 'expired');
    stubFetch(() => ({ status: 401, body: { success: false, code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' } }));
    renderPage();
    expect(await screen.findByTestId('sign-in-required')).toHaveTextContent('Your session has expired');
  });
});

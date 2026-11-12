/**
 * The panel must keep forecast, measured observations, provider estimates and missing data
 * visibly separate. Data here is hand-written test data in the backend's response shape.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { CarbonObservationPanel } from '../../src/components/CarbonObservationPanel';
import type { JobObservationsResult, ObservationSetRecord } from '../../src/types';

const T = ['2026-11-12T20:00:00.000Z', '2026-11-12T21:00:00.000Z', '2026-11-12T22:00:00.000Z'];

const set = (over: Partial<ObservationSetRecord> = {}): ObservationSetRecord => ({
  id: 'obs-1',
  status: 'PARTIAL',
  statusDetail: 'No observation was available for 1 of 3 interval(s).',
  collectedAt: '2026-11-12T23:10:00.000Z',
  window: { startUtc: T[0], endUtc: '2026-11-12T23:00:00.000Z' },
  intervals: T,
  observations: [
    { datetime: T[0], carbonIntensity: 100, isEstimated: false, estimationMethod: null, quality: 'measured' },
    { datetime: T[1], carbonIntensity: 120, isEstimated: true, estimationMethod: 'FORECASTS_HIERARCHY', quality: 'provider-estimate' },
  ],
  missingIntervals: [T[2]],
  ...over,
});

const result = (over: Partial<JobObservationsResult> = {}): JobObservationsResult => ({
  observationSet: set(),
  evaluation: {
    pairs: [
      { datetime: T[0], forecast: 110, observed: 100, error: 10, quality: 'measured', estimationMethod: null },
      { datetime: T[1], forecast: 115, observed: 120, error: -5, quality: 'provider-estimate', estimationMethod: 'FORECASTS_HIERARCHY' },
    ],
    unmatchedIntervals: [T[2]],
    measured: { n: 1, mae: 10, rmse: 10, bias: 10, unit: 'gCO2eq/kWh' },
    providerEstimate: { n: 1, mae: 5, rmse: 5, bias: -5, unit: 'gCO2eq/kWh' },
  },
  realized: { averageIntensity: null, emissionsGrams: null, quality: null, coverage: { observed: 2, expected: 3 }, reason: 'Observations exist for 2 of 3 interval(s); realized values are only computed with full coverage.' },
  observedComparison: { unavailable: true, reason: 'Both windows need full observation coverage before an observed comparison is made.' },
  ...over,
});

const renderPanel = (r: JobObservationsResult | null, extra: Partial<React.ComponentProps<typeof CarbonObservationPanel>> = {}) =>
  render(
    <CarbonObservationPanel
      jobId="job-1"
      result={r}
      collecting={false}
      error={null}
      onCollect={() => {}}
      reportHtmlUrl="http://x/report?format=html"
      reportJsonUrl="http://x/report"
      {...extra}
    />
  );

describe('CarbonObservationPanel', () => {
  it('labels each interval as measured, provider estimate or missing, with forecast values from the stored snapshot', () => {
    renderPanel(result());
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Measured')).toBeInTheDocument();
    expect(within(rows[0]).getByText('110')).toBeInTheDocument();
    expect(within(rows[0]).getByText('10')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Provider estimate')).toBeInTheDocument();
    expect(within(rows[1]).getByText('FORECASTS_HIERARCHY')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No observation')).toBeInTheDocument();
    expect(within(rows[2]).getByText('not calculable')).toBeInTheDocument();
  });

  it('reports measured error and provider-estimate agreement separately', () => {
    renderPanel(result());
    expect(screen.getByText('Forecast error vs measured observations').parentElement).toHaveTextContent('MAE 10');
    expect(screen.getByText('Forecast vs provider estimates (model vs model)').parentElement).toHaveTextContent('MAE 5');
  });

  it('shows why realized values and the observed comparison are unavailable instead of numbers', () => {
    renderPanel(result());
    expect(screen.getByText(/only computed with full coverage/)).toBeInTheDocument();
    expect(screen.getByText(/Both windows need full observation coverage/)).toBeInTheDocument();
  });

  it('shows a pending window without a table or metrics', () => {
    renderPanel({
      observationSet: set({ status: 'PENDING_WINDOW_NOT_FINISHED', statusDetail: 'The scheduled window ends at …', observations: [], missingIntervals: [] }),
      evaluation: null,
      realized: null,
      observedComparison: null,
    });
    expect(screen.getByText('Waiting for the scheduled window to finish')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/Forecast error vs measured/)).toBeNull();
  });

  it('says when measured error is not calculable', () => {
    renderPanel(result({ evaluation: { ...result().evaluation!, measured: null } }));
    expect(screen.getByText(/Not calculable: no measured observations/)).toBeInTheDocument();
  });

  it('collect button and report links', () => {
    const onCollect = vi.fn();
    renderPanel(null, { onCollect });
    fireEvent.click(screen.getByRole('button', { name: /Collect carbon observations/ }));
    expect(onCollect).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Download report \(HTML\)/ })).toHaveAttribute('href', 'http://x/report?format=html');
  });
});

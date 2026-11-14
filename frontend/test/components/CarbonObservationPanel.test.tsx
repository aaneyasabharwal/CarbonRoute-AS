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
  intensity: {
    window: { startUtc: T[0], endUtc: '2026-11-12T23:00:00.000Z' },
    emissionFactorType: 'lifecycle',
    forecast: { value: 113.33, complete: true, windowMinutes: 180, coveredMinutes: 180, segments: [], missing: [], reason: 'Time-weighted from the stored forecast snapshot.' },
    observed: {
      value: null,
      complete: false,
      windowMinutes: 180,
      coveredMinutes: 120,
      segments: [],
      missing: [{ start: T[2], end: '2026-11-12T23:00:00.000Z' }],
      quality: null,
      excludedForEmissionFactor: [],
      reason: 'Observations cover 120 min of 180 min; the observed intensity is only computed when the whole window is covered.',
    },
  },
  emissions: {
    realized: { available: false, label: 'Realized emissions unavailable', reason: 'No energy consumption was recorded for this execution (it was simulated and no power measurement exists), so realized emissions cannot be calculated.' },
    estimated: { label: 'Estimated emissions (assumed energy)', grams: null, energyKwh: 0.25, energyBasis: 'Assumption. Not measured.', intensityQuality: null, reason: 'Not calculable: the observed intensity is not available for the whole window.' },
  },
  windowComparison: {
    available: false,
    emissionFactorType: 'lifecycle',
    recommended: { window: { startUtc: T[0], endUtc: '2026-11-12T23:00:00.000Z' }, forecastIntensity: 113.33, observedIntensity: null, observedQuality: null },
    immediate: { window: { startUtc: T[0], endUtc: '2026-11-12T23:00:00.000Z' }, forecastIntensity: 113.33, observedIntensity: null, observedQuality: null },
    forecastDifference: 0,
    observedDifference: null,
    observedDifferencePct: null,
    estimatedEmissions: { label: 'Estimated emissions (assumed energy)', recommendedGrams: null, immediateGrams: null, basis: 'assumed' },
    realizedEmissions: 'unavailable: no recorded energy for either window',
    unit: 'gCO2eq/kWh',
    basis: 'Not available: the recommended window is not fully observed.',
  },
  ...over,
});

/** The live demo's corrected values (job-7f42a910), as returned by the fixed backend. */
const demoResult = (overEmissions: Partial<JobObservationsResult['emissions']> = {}): JobObservationsResult => ({
  observationSet: set({ status: 'COMPLETE', intervals: ['2026-11-12T20:00:00.000Z'], observations: [{ datetime: '2026-11-12T20:00:00.000Z', carbonIntensity: 123, isEstimated: false, estimationMethod: null, quality: 'measured' }], missingIntervals: [] }),
  evaluation: {
    pairs: [{ datetime: '2026-11-12T20:00:00.000Z', forecast: 117, observed: 123, error: -6, quality: 'measured', estimationMethod: null }],
    unmatchedIntervals: [],
    measured: { n: 1, mae: 6, rmse: 6, bias: -6, unit: 'gCO2eq/kWh' },
    providerEstimate: null,
  },
  intensity: {
    window: { startUtc: '2026-11-12T20:00:00.000Z', endUtc: '2026-11-12T21:00:00.000Z' },
    emissionFactorType: 'lifecycle',
    forecast: { value: 117, complete: true, windowMinutes: 60, coveredMinutes: 60, segments: [], missing: [], reason: 'Time-weighted from the stored forecast snapshot.' },
    observed: { value: 123, complete: true, windowMinutes: 60, coveredMinutes: 60, segments: [], missing: [], quality: 'measured', excludedForEmissionFactor: [], reason: 'Every observed interval is a measurement.' },
  },
  emissions: {
    realized: { available: false, label: 'Realized emissions unavailable', reason: 'No energy consumption was recorded for this execution (it was simulated and no power measurement exists), so realized emissions cannot be calculated.' },
    estimated: { label: 'Estimated emissions (assumed energy)', grams: 30.8, energyKwh: 0.25, energyBasis: 'Assumption: 0.125 kW per requested vCPU (minimum 0.1 kW). Not measured.', intensityQuality: 'measured', reason: 'Observed intensity multiplied by an ASSUMED energy use.' },
    ...overEmissions,
  } as JobObservationsResult['emissions'],
  windowComparison: {
    available: true,
    emissionFactorType: 'lifecycle',
    recommended: { window: { startUtc: '2026-11-12T20:00:00.000Z', endUtc: '2026-11-12T21:00:00.000Z' }, forecastIntensity: 117, observedIntensity: 123, observedQuality: 'measured' },
    immediate: { window: { startUtc: '2026-11-12T19:49:57.531Z', endUtc: '2026-11-12T20:49:57.531Z' }, forecastIntensity: 117.33, observedIntensity: 124.34, observedQuality: 'measured' },
    forecastDifference: 0.33,
    observedDifference: 1.34,
    observedDifferencePct: 1.08,
    estimatedEmissions: { label: 'Estimated emissions (assumed energy)', recommendedGrams: 30.8, immediateGrams: 31.1, basis: 'Both use the same ASSUMED energy; not measured or realized emissions.' },
    realizedEmissions: 'unavailable: no recorded energy for either window',
    unit: 'gCO2eq/kWh',
    basis: 'Time-weighted intensities (each interval weighted by the minutes it overlaps the window). This is a counterfactual comparison: the job ran only once.',
  },
});

const renderPanel = (r: JobObservationsResult | null, extra: Partial<React.ComponentProps<typeof CarbonObservationPanel>> = {}) =>
  render(
    <CarbonObservationPanel
      jobId="job-1"
      result={r}
      collecting={false}
      error={null}
      onCollect={() => {}}
      onDownloadReport={() => {}}
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

  it('shows why window intensity, emissions and the comparison are unavailable instead of numbers', () => {
    renderPanel(result());
    expect(screen.getByTestId('window-intensity')).toHaveTextContent('Observed: not available');
    expect(screen.getByText(/only computed when the whole window is covered/)).toBeInTheDocument();
    expect(screen.getByText('Realized emissions unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Not calculable: the observed intensity is not available/)).toBeInTheDocument();
    expect(screen.getByText(/recommended window is not fully observed/)).toBeInTheDocument();
  });

  it('shows a pending window without a table or metrics', () => {
    renderPanel({
      observationSet: set({ status: 'PENDING_WINDOW_NOT_FINISHED', statusDetail: 'The scheduled window ends at …', observations: [], missingIntervals: [] }),
      evaluation: null,
      intensity: null,
      emissions: null,
      windowComparison: null,
    });
    expect(screen.getByText('Waiting for the scheduled window to finish')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/Forecast error vs measured/)).toBeNull();
  });

  it('says when measured error is not calculable', () => {
    renderPanel(result({ evaluation: { ...result().evaluation!, measured: null } }));
    expect(screen.getByText(/Not calculable: no measured observations/)).toBeInTheDocument();
  });

  // Regression (defect 1): the Immediate window is shown with time-weighted values.
  it('shows the corrected time-weighted demo values, not the old equal-weight ones', () => {
    renderPanel(demoResult());
    const cmp = screen.getByTestId('window-comparison');
    expect(cmp).toHaveTextContent('Comparison with Immediate execution (time-weighted intensity)');
    expect(cmp).toHaveTextContent('Observed: recommended 123 vs Immediate 124.34 gCO2eq/kWh (difference 1.34 gCO2eq/kWh, 1.08%)');
    expect(cmp).toHaveTextContent('Forecast: recommended 117 vs Immediate 117.33 gCO2eq/kWh');
    expect(cmp).not.toHaveTextContent('127');
    expect(screen.getByTestId('window-intensity')).toHaveTextContent('Forecast: 117 gCO2eq/kWh · Observed: 123 gCO2eq/kWh');
    expect(screen.getByTestId('window-intensity')).toHaveTextContent('Measured');
  });

  // Regression (defect 2): assumed-energy emissions are never shown as realized.
  it('labels assumed-energy emissions as an estimate and realized emissions as unavailable', () => {
    renderPanel(demoResult());
    const em = screen.getByTestId('emissions');
    expect(em).toHaveTextContent('Realized emissions unavailable');
    expect(em).toHaveTextContent('No energy consumption was recorded');
    expect(em).toHaveTextContent('Estimated emissions (assumed energy)');
    expect(em).toHaveTextContent('30.8 gCO2eq (estimate, not a realized emission)');
    expect(em).toHaveTextContent('Energy assumption: 0.25 kWh');
    expect(screen.queryByText(/Realized window/)).toBeNull();
    expect(screen.queryByText(/Observed comparison with Immediate/)).toBeNull();
  });

  it('shows realized emissions only when energy was recorded', () => {
    renderPanel(demoResult({ realized: { available: true, grams: 49.2, energyKwh: 0.4, energySource: 'recorded', intensityQuality: 'measured' } }));
    const em = screen.getByTestId('emissions');
    expect(em).toHaveTextContent('Realized emissions (recorded energy)');
    expect(em).toHaveTextContent('49.2 gCO2eq (0.4 kWh recorded)');
    expect(em).toHaveTextContent('Estimated emissions (assumed energy)');
  });

  it('marks a window that mixes measured values and provider estimates', () => {
    const r = demoResult();
    r.intensity!.observed.quality = 'mixed';
    renderPanel(r);
    expect(screen.getByTestId('window-intensity')).toHaveTextContent('Mixed: measured and provider estimates');
  });

  it('collect button and report download buttons', () => {
    const onCollect = vi.fn();
    const onDownloadReport = vi.fn();
    renderPanel(null, { onCollect, onDownloadReport });
    fireEvent.click(screen.getByRole('button', { name: /Collect carbon observations/ }));
    expect(onCollect).toHaveBeenCalled();
    // M1.2: reports need the sign-in token, so they are downloaded by the app, not plain links.
    expect(screen.queryByRole('link', { name: /Download report/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Download report \(HTML\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /Report data \(JSON\)/ }));
    expect(onDownloadReport.mock.calls).toEqual([['html'], ['json']]);
  });
});

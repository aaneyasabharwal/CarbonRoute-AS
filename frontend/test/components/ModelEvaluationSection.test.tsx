/**
 * P5: the model section shows the stored evaluation as-is; without enough data it shows no
 * model metrics at all (hand-written data in the API's shape).
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ModelEvaluationSection } from '../../src/components/ModelEvaluationSection';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

const metrics = (mae: number | null, n: number) => ({ n, mae, rmse: mae, bias: mae === null ? null : 1 });
const base = {
  id: 'ml-2026-11-13T18-00-00-000Z',
  createdAt: '2026-11-13T18:00:00.000Z',
  dataset: { rows: 50, measuredRows: 16, zones: ['DE', 'GB'], spanDays: 0.13 },
  thresholds: { minTrainRows: 500, minValidationRows: 100, minTestRows: 200, minSpanDays: 7 },
  providerErrorAllRows: { all: metrics(20.18, 50), measuredOnly: metrics(14.69, 16) },
  anomalies: { method: 'robust-z of forecast error per zone (median / MAD), unsupervised', zones: [{ zone: 'DE', rows: 10, status: 'insufficient-data', flagged: [] }] },
  notes: [],
};

function backend(evaluation: unknown) {
  return stubFetch((url) => {
    if (url === `${API_BASE}/results/ml`) return { body: { success: true, data: evaluation ? [{ id: base.id, createdAt: base.createdAt, status: (evaluation as any).status, dataset: base.dataset }] : [] } };
    if (url === `${API_BASE}/results/ml/${base.id}`) return { body: { success: true, data: evaluation } };
    return undefined;
  });
}

beforeEach(() => localStorage.setItem('carbonroute_token', 't'));

describe('ModelEvaluationSection', () => {
  it('insufficient data: explains why, shows the thresholds and the provider error, and NO model scores', async () => {
    backend({ ...base, status: 'insufficient-data', statusReasons: ['Training rows 15 < 500.', 'No model was fitted. Reliable training is pending more collected data.'], split: null, testScores: null });
    render(<ModelEvaluationSection />);
    const el = await screen.findByTestId('ml-evaluation');
    expect(el).toHaveTextContent('Not trained: not enough data yet');
    expect(el).toHaveTextContent('No model was fitted');
    expect(el).toHaveTextContent('Required before training: 500 training, 100 validation and 200 test pairs over at least 7 days');
    expect(el).toHaveTextContent('Provider forecast error (descriptive, not a model): MAE 20.18');
    expect(screen.queryByRole('table', { name: 'Model test scores' })).toBeNull();
    expect(el).toHaveTextContent('unsupervised');
  });

  it('evaluated: shows held-out test scores per model, with measured-only metrics', async () => {
    backend({
      ...base,
      status: 'evaluated-not-promoted',
      statusReasons: ['Not promoted: candidate test MAE is 99.0% of the best baseline (bias-corrected).'],
      split: { train: 600, validation: 150, test: 250, droppedForGap: 40 },
      testScores: [
        { model: 'provider-as-is', all: metrics(20, 250), measuredOnly: metrics(15, 100) },
        { model: 'ridge-error-correction', all: metrics(19.8, 250), measuredOnly: metrics(14.9, 100) },
      ],
    });
    render(<ModelEvaluationSection />);
    expect(await screen.findByTestId('ml-evaluation')).toHaveTextContent('did not beat the baselines');
    const rows = within(screen.getByRole('table', { name: 'Model test scores' })).getAllByRole('row');
    expect(rows[2]).toHaveTextContent('ridge-error-correction19.8019.80');
    expect(rows[2]).toHaveTextContent('14.90 (100)');
  });

  it('shows an empty state before any evaluation, and an error when the backend fails', async () => {
    backend(null);
    const { unmount } = render(<ModelEvaluationSection />);
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('npm run ml');
    unmount();
    stubFetch(() => ({ status: 500, body: { success: false, message: 'cannot read ml results' } }));
    render(<ModelEvaluationSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot read ml results');
  });
});

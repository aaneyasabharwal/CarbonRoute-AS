/**
 * Forecast-error model evaluation (P5). Shows the latest `npm run ml` report exactly as the
 * backend stored it. When the data is insufficient it says so and shows NO model metrics: a
 * model that was not trained has no accuracy to report.
 */
import React, { useEffect, useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { api } from '../services/api';
import type { MlEvaluation } from '../types';
import { EmptyState, ErrorState, LoadingState } from './StateViews';
import { DataQualityBadge } from './DataQualityBadge';

type Load = { state: 'loading' } | { state: 'empty' } | { state: 'ok'; data: MlEvaluation } | { state: 'error'; message: string };

const STATUS_LABEL: Record<MlEvaluation['status'], string> = {
  'insufficient-data': 'Not trained: not enough data yet',
  'evaluated-not-promoted': 'Evaluated on held-out data: did not beat the baselines',
  'evaluated-promoted': 'Evaluated on held-out data: beat the baselines (not used for scheduling)',
};
const fmt = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x.toFixed(2));

export const ModelEvaluationSection: React.FC = () => {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    (async () => {
      const list = await api.listMlEvaluations();
      if (!list.success || !list.data) return setLoad({ state: 'error', message: list.message || 'Could not load model evaluations.' });
      if (list.data.length === 0) return setLoad({ state: 'empty' });
      const one = await api.getMlEvaluation(list.data[0].id);
      setLoad(one.success && one.data ? { state: 'ok', data: one.data } : { state: 'error', message: one.message || 'Could not load the model evaluation.' });
    })();
  }, []);

  return (
    <section aria-label="Forecast-error model" className="space-y-3">
      <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
        <BrainCircuit className="w-4 h-4 text-sky-300" aria-hidden="true" /> Forecast-error model (machine learning)
      </h2>
      {load.state === 'loading' ? (
        <LoadingState label="Loading model evaluation…" />
      ) : load.state === 'error' ? (
        <ErrorState message={load.message} />
      ) : load.state === 'empty' ? (
        <EmptyState title="No model evaluation yet">
          <p>
            Run <code className="text-slate-200">npm run ml -- --data &lt;collection dir&gt;</code> in <code>backend/</code>.
          </p>
        </EmptyState>
      ) : (
        <ModelView m={load.data} />
      )}
    </section>
  );
};

const ModelView: React.FC<{ m: MlEvaluation }> = ({ m }) => (
  <div data-testid="ml-evaluation" className="p-4 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-3">
    <div className="font-bold text-slate-100">{STATUS_LABEL[m.status]}</div>
    <ul className="list-disc pl-5 text-slate-400">
      {m.statusReasons.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
    <div className="text-slate-400">
      Data: {m.dataset.rows} forecast/realized pairs ({m.dataset.measuredRows} measured) from {m.dataset.zones.join(', ') || 'no zones'}, spanning {m.dataset.spanDays} days.
      Required before training: {m.thresholds.minTrainRows} training, {m.thresholds.minValidationRows} validation and {m.thresholds.minTestRows} test pairs over at least{' '}
      {m.thresholds.minSpanDays} days.
    </div>
    <div className="flex flex-wrap items-center gap-2">
      Provider forecast error (descriptive, not a model): MAE {fmt(m.providerErrorAllRows.all.mae)} vs all realized values;
      <DataQualityBadge quality="measured" /> only: MAE {fmt(m.providerErrorAllRows.measuredOnly.mae)} (n={m.providerErrorAllRows.measuredOnly.n})
    </div>
    {m.status !== 'insufficient-data' && m.testScores && (
      <table className="w-full text-left" aria-label="Model test scores">
        <thead className="text-slate-400 border-b border-slate-800">
          <tr>
            <th className="py-1 pr-3">Model (held-out test period)</th>
            <th className="py-1 pr-3">MAE</th>
            <th className="py-1 pr-3">RMSE</th>
            <th className="py-1 pr-3">Bias</th>
            <th className="py-1">MAE vs measured (n)</th>
          </tr>
        </thead>
        <tbody>
          {m.testScores.map((s) => (
            <tr key={s.model} className="border-b border-slate-900">
              <td className="py-1 pr-3">{s.model}</td>
              <td className="py-1 pr-3">{fmt(s.all.mae)}</td>
              <td className="py-1 pr-3">{fmt(s.all.rmse)}</td>
              <td className="py-1 pr-3">{fmt(s.all.bias)}</td>
              <td className="py-1">
                {fmt(s.measuredOnly.mae)} ({s.measuredOnly.n})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <div className="text-slate-500">
      Anomaly flags ({m.anomalies.method}): {m.anomalies.interpretation || 'Unsupervised screening flags, not confirmed failures.'}{' '}
      {m.anomalies.zones.map((z) => `${z.zone} ${z.status}`).join(' · ')}
    </div>
  </div>
);

/**
 * Experiment results (P4): algorithm comparison and forecast accuracy from stored benchmark
 * runs (`npm run benchmark`). Shows what each run actually measured: intervals, how many
 * workloads could be scored, and which values are measured vs provider estimates.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '../services/api';
import type { BenchmarkListItem, BenchmarkResultDetail, ConfidenceIntervalResult } from '../types';
import { EmptyState, ErrorState, LoadingState, SignInRequired } from '../components/StateViews';
import { DataQualityBadge } from '../components/DataQualityBadge';
import { ModelEvaluationSection } from '../components/ModelEvaluationSection';

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string; auth?: boolean };

const POLICY_NAME: Record<string, string> = {
  immediate: 'Immediate',
  edf: 'EDF (= Immediate, single job)',
  deterministic_carbon: 'Greedy carbon-aware',
  carbon_aware_baseline: 'CarbonAware baseline',
  carbonroute_uncertainty: 'CarbonRoute (risk-constrained)',
};
const fmt = (x: number | null | undefined, dp = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(dp));
const ci = (c: ConfidenceIntervalResult) => (c.low === null || c.high === null ? 'no interval' : `[${fmt(c.low)}, ${fmt(c.high)}]`);

export const ResultsPage: React.FC = () => {
  const [list, setList] = useState<Load<BenchmarkListItem[]>>({ state: 'idle' });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Load<BenchmarkResultDetail>>({ state: 'idle' });
  const signedIn = api.hasSession();

  const loadList = useCallback(async () => {
    setList({ state: 'loading' });
    const res = await api.listBenchmarks();
    if (res.success && res.data) {
      setList({ state: 'ok', data: res.data });
      if (res.data.length > 0) setSelected((s) => s ?? res.data![0].id);
    } else setList({ state: 'error', message: res.message || 'Could not load results.', auth: res.authRequired });
  }, []);

  useEffect(() => {
    if (signedIn) loadList();
  }, [signedIn, loadList]);

  useEffect(() => {
    if (!selected) return;
    setDetail({ state: 'loading' });
    api.getBenchmark(selected).then((res) =>
      setDetail(res.success && res.data ? { state: 'ok', data: res.data } : { state: 'error', message: res.message || 'Could not load the result.' })
    );
  }, [selected]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-emerald-400" aria-hidden="true" /> Experiment results
        </h1>
        <p className="text-sm text-slate-400">Policy comparison and forecast accuracy from stored benchmark runs on collected Electricity Maps data.</p>
      </header>
      {list.state === 'error' && list.auth ? (
        <SignInRequired what="experiment results" message={list.message} />
      ) : !signedIn ? (
        <SignInRequired what="experiment results" message="Results are available to signed-in users." />
      ) : list.state === 'idle' || list.state === 'loading' ? (
        <LoadingState label="Loading results…" />
      ) : list.state === 'error' ? (
        <ErrorState message={list.message} onRetry={loadList} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No benchmark results yet">
          <p>
            Run <code className="text-slate-200">npm run benchmark -- --data &lt;collection dir&gt;</code> in <code>backend/</code> after collecting data. Results appear here; nothing is shown until a
            run exists.
          </p>
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <label className="text-xs text-slate-400 flex items-center gap-2">
            Run
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200">
              {list.data.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.createdAt} · {r.dataset.zones.join(', ')} · seed {r.seed}
                </option>
              ))}
            </select>
          </label>
          {detail.state === 'idle' || detail.state === 'loading' ? (
            <LoadingState label="Loading run…" />
          ) : detail.state === 'error' ? (
            <ErrorState message={detail.message} />
          ) : (
            <RunView r={detail.data} />
          )}
        </div>
      )}
      {signedIn && !(list.state === 'error' && list.auth) && <ModelEvaluationSection />}
    </div>
  );
};

const RunView: React.FC<{ r: BenchmarkResultDetail }> = ({ r }) => (
  <div className="space-y-6" data-testid="benchmark-run">
    <section className="p-4 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <DataQualityBadge quality="forecast">Real forecasts</DataQualityBadge>
        <DataQualityBadge quality="synthetic">Synthetic workloads</DataQualityBadge>
        <DataQualityBadge quality="assumed">Assumed energy</DataQualityBadge>
      </div>
      <div>
        Zones {r.dataset.zones.join(', ')} · {r.dataset.snapshots} forecast snapshots · {r.dataset.realizedIntervals} realized hourly values, of which{' '}
        {r.dataset.measuredShare === null ? 'n/a' : `${(r.dataset.measuredShare * 100).toFixed(1)}%`} measured (the rest are provider estimates).
      </div>
      <div>
        Commit {r.gitCommit ?? 'unknown'} · config {r.configSha256.slice(0, 12)} · dataset {r.dataset.sha256.slice(0, 12)} · seed {r.seed}
      </div>
    </section>

    {r.scenarios.map((s) => (
      <section key={s.runtimeCv} aria-label={`Policies, runtime CV ${s.runtimeCv}`} className="space-y-2">
        <h2 className="text-sm font-bold text-slate-100">
          Policy comparison — declared runtime CV {s.runtimeCv}
          {s.runtimeCv === 0 ? ' (deterministic runtime)' : ''}
        </h2>
        <p className="text-xs text-slate-400">
          {s.workloads} workloads · {s.infeasible} without a CarbonRoute recommendation · {s.pendingRealized} with at least one policy window not yet fully
          observed (those windows are not scored; see Scored / decisions per policy) · hindsight Oracle available for {s.oracleAvailable} (offline evaluation only).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left" aria-label={`Policy comparison CV ${s.runtimeCv}`}>
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2 pr-3">Policy</th>
                <th className="py-2 pr-3">Scored / decisions</th>
                <th className="py-2 pr-3">Realized gCO2eq/kWh [95% CI]</th>
                <th className="py-2 pr-3">Δ vs Immediate [95% CI]</th>
                <th className="py-2 pr-3">Delay h</th>
                <th className="py-2 pr-3">Deadline violations</th>
                <th className="py-2 pr-3">Regret vs Oracle</th>
                <th className="py-2">Est. emissions g</th>
              </tr>
            </thead>
            <tbody>
              {s.policies.map((p) => (
                <tr key={p.policyId} className="border-b border-slate-900 text-slate-300">
                  <td className="py-2 pr-3 font-bold">{POLICY_NAME[p.policyId] || p.policyId}</td>
                  <td className="py-2 pr-3">
                    {p.scored} / {p.decisions}
                  </td>
                  <td className="py-2 pr-3" title={p.realizedIntensityCI.note}>
                    {fmt(p.meanRealizedIntensity)} {ci(p.realizedIntensityCI)}
                  </td>
                  {p.diffVsImmediateClusterCI ? (
                    <td className="py-2 pr-3" title="Cluster bootstrap over forecast snapshots">
                      {fmt(p.diffVsImmediateClusterCI.estimate)} {ci(p.diffVsImmediateClusterCI)} (n={p.diffVsImmediateClusterCI.n}, {p.diffVsImmediateClusterCI.clusters} snapshots)
                    </td>
                  ) : (
                    <td className="py-2 pr-3" title="Older result: workloads resampled individually, so the interval is too narrow">
                      {fmt(p.diffVsImmediateCI.estimate)} {ci(p.diffVsImmediateCI)} (n={p.diffVsImmediateCI.n}; workload-level interval, optimistic)
                    </td>
                  )}
                  <td className="py-2 pr-3">{fmt(p.meanDelayHours)}</td>
                  <td className="py-2 pr-3">{p.deadlineViolationRate === null ? 'n/a' : `${(p.deadlineViolationRate * 100).toFixed(1)}%`}</td>
                  <td className="py-2 pr-3">{fmt(p.meanRegretVsOracle)}</td>
                  <td className="py-2">{fmt(p.meanEstimatedEmissionsGrams, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ))}

    {r.accuracy && (
      <section aria-label="Forecast accuracy" className="space-y-2">
        <h2 className="text-sm font-bold text-slate-100">Forecast accuracy (forecast − realized)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left" aria-label="Forecast accuracy">
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2 pr-3">Zone</th>
                <th className="py-2 pr-3">Pairs</th>
                <th className="py-2 pr-3">MAE (all realized)</th>
                <th className="py-2 pr-3">RMSE</th>
                <th className="py-2 pr-3">Bias</th>
                <th className="py-2 pr-3">
                  MAE vs <DataQualityBadge quality="measured" /> (n)
                </th>
                <th className="py-2">
                  MAE vs <DataQualityBadge quality="provider-estimate" /> (n)
                </th>
              </tr>
            </thead>
            <tbody>
              {r.accuracy.zones.map((z) => (
                <tr key={z.zone} className="border-b border-slate-900 text-slate-300">
                  <td className="py-2 pr-3 font-bold">{z.zone}</td>
                  <td className="py-2 pr-3">{z.pairs}</td>
                  <td className="py-2 pr-3">{fmt(z.all.mae)}</td>
                  <td className="py-2 pr-3">{fmt(z.all.rmse)}</td>
                  <td className="py-2 pr-3">{fmt(z.all.bias)}</td>
                  <td className="py-2 pr-3">
                    {fmt(z.measuredOnly.mae)} ({z.measuredOnly.n})
                  </td>
                  <td className="py-2">
                    {fmt(z.estimatedOnly.mae)} ({z.estimatedOnly.n})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}

    <section className="text-xs text-slate-500">
      <h2 className="font-bold text-slate-300 mb-1">Notes</h2>
      <ul className="list-disc pl-5 space-y-0.5">
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  </div>
);

export default ResultsPage;

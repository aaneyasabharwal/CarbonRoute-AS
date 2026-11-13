/**
 * Dashboard (P8). Replaces the former "UI architecture preview" (placeholder panels with no data).
 * Every value comes from the backend; a section whose request fails says so and shows no numbers.
 *  - My jobs: counts by status and the most recent jobs (signed-in users).
 *  - Latest replay benchmark: CarbonRoute vs Immediate per declared runtime CV, read with the same
 *    rule as the research report (a difference is only "lower" when its interval excludes 0).
 *  - Forecast-error model status (never an accuracy unless a model was evaluated).
 *  - Live data provider configuration and call budget; execution mode (Kubernetes or simulated).
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, History, BarChart3, BrainCircuit, PlugZap, Server, Cpu } from 'lucide-react';
import { api } from '../services/api';
import type { BenchmarkResultDetail, JobSummary, MlEvaluationListItem } from '../types';
import { EmptyState, ErrorState, LoadingState, SignInRequired } from '../components/StateViews';

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'empty' } | { state: 'error'; message: string; auth?: boolean };

const fmt = (x: number | null | undefined, dp = 2) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : x.toFixed(dp));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

/** Same rule as the research report generator (backend/src/scripts/researchReport.ts). */
export function readDifference(ci: { estimate: number | null; low: number | null; high: number | null } | undefined | null): string {
  if (!ci || ci.estimate === null) return 'not available';
  if (ci.low === null || ci.high === null) return 'no interval (too few snapshots)';
  if (ci.low <= 0 && ci.high >= 0) return 'no evidence of a difference';
  return ci.high < 0 ? 'lower than Immediate in this sample' : 'higher than Immediate in this sample';
}

const Card: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode; label: string }> = ({ title, icon: Icon, children, label }) => (
  <section aria-label={label} className="p-5 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
    <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
      <Icon className="w-4 h-4 text-emerald-300" aria-hidden="true" /> {title}
    </h2>
    {children}
  </section>
);

export const DashboardPage: React.FC = () => {
  const signedIn = api.hasSession();
  const [jobs, setJobs] = useState<Load<JobSummary[]>>({ state: 'loading' });
  const [bench, setBench] = useState<Load<BenchmarkResultDetail>>({ state: 'loading' });
  const [ml, setMl] = useState<Load<MlEvaluationListItem>>({ state: 'loading' });
  const [provider, setProvider] = useState<Load<any>>({ state: 'loading' });
  const [cluster, setCluster] = useState<Load<{ isAvailable: boolean; message: string }>>({ state: 'loading' });

  useEffect(() => {
    (async () => {
      const [p, c] = await Promise.all([api.getProviderStatus(), api.getClusterHealth()]);
      setProvider(p.success && p.data ? { state: 'ok', data: p.data } : { state: 'error', message: p.message || 'Provider status unavailable.' });
      setCluster(c.success && c.data ? { state: 'ok', data: c.data } : { state: 'error', message: c.message || 'Cluster status unavailable.' });
    })();
    if (!signedIn) return;
    (async () => {
      const j = await api.listJobs();
      setJobs(j.success && j.data ? (j.data.length ? { state: 'ok', data: j.data } : { state: 'empty' }) : { state: 'error', message: j.message || 'Could not load jobs.', auth: j.authRequired });
    })();
    (async () => {
      const list = await api.listBenchmarks();
      if (!list.success || !list.data) return setBench({ state: 'error', message: list.message || 'Could not load benchmarks.', auth: list.authRequired });
      if (!list.data.length) return setBench({ state: 'empty' });
      const one = await api.getBenchmark(list.data[0].id);
      setBench(one.success && one.data ? { state: 'ok', data: one.data } : { state: 'error', message: one.message || 'Could not load the benchmark.' });
    })();
    (async () => {
      const list = await api.listMlEvaluations();
      if (!list.success || !list.data) return setMl({ state: 'error', message: list.message || 'Could not load model evaluations.' });
      setMl(list.data.length ? { state: 'ok', data: list.data[0] } : { state: 'empty' });
    })();
  }, [signedIn]);

  const authLost = [jobs, bench].some((l) => l.state === 'error' && l.auth);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-mono flex items-center gap-3">
            <LayoutDashboard className="w-7 h-7 text-emerald-400" aria-hidden="true" /> Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">Current state of your jobs, the latest experiment results and the platform, from the backend.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link to="/prototype" className="px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400">Schedule a job</Link>
          <Link to="/jobs" className="px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">My jobs</Link>
          <Link to="/results" className="px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">Results</Link>
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Live carbon data" icon={PlugZap} label="Live data provider">
          {provider.state === 'loading' ? (
            <LoadingState label="Loading provider status…" />
          ) : provider.state === 'error' ? (
            <ErrorState message={provider.message} />
          ) : provider.state === 'ok' ? (
            <div className="text-xs text-slate-300 space-y-1" data-testid="provider-status">
              <div>
                Electricity Maps: <strong className={provider.data.configured ? 'text-emerald-300' : 'text-amber-300'}>{provider.data.configured ? 'configured' : 'not configured (only the synthetic demo trace is available)'}</strong>
              </div>
              {provider.data.callBudget && (
                <div>
                  Server call budget: {provider.data.callBudget.lastHour}/{provider.data.callBudget.maxPerHour} this hour, {provider.data.callBudget.lastDay}/{provider.data.callBudget.maxPerDay} in 24 h
                </div>
              )}
              <div className="text-slate-500">History window {provider.data.historyWindowHours} h; past ranges {provider.data.pastRangeAvailable ? 'available' : 'not in this plan'}.</div>
            </div>
          ) : null}
        </Card>

        <Card title="Execution" icon={Server} label="Execution mode">
          {cluster.state === 'loading' ? (
            <LoadingState label="Checking for a cluster…" />
          ) : cluster.state === 'error' ? (
            <ErrorState message={cluster.message} />
          ) : cluster.state === 'ok' ? (
            <div className="text-xs text-slate-300" data-testid="execution-mode">
              <strong className={cluster.data.isAvailable ? 'text-emerald-300' : 'text-amber-300'}>{cluster.data.isAvailable ? 'Kubernetes' : 'Simulated'}</strong>: {cluster.data.message}
            </div>
          ) : null}
        </Card>
      </div>

      {!signedIn || authLost ? (
        <SignInRequired what="your jobs and experiment results" />
      ) : (
        <>
          <Card title="My jobs" icon={History} label="My jobs summary">
            {jobs.state === 'loading' ? (
              <LoadingState label="Loading jobs…" />
            ) : jobs.state === 'error' ? (
              <ErrorState message={jobs.message} />
            ) : jobs.state === 'empty' ? (
              <EmptyState title="No jobs yet">
                <p>
                  <Link to="/prototype" className="text-emerald-300 underline">Schedule a job</Link> to see it here.
                </p>
              </EmptyState>
            ) : jobs.state === 'ok' ? (
              <JobsSummary jobs={jobs.data} />
            ) : null}
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Latest replay benchmark" icon={BarChart3} label="Latest benchmark">
              {bench.state === 'loading' ? (
                <LoadingState label="Loading benchmark…" />
              ) : bench.state === 'error' ? (
                <ErrorState message={bench.message} />
              ) : bench.state === 'empty' ? (
                <EmptyState title="No benchmark yet">
                  <p>Run <code>npm run benchmark</code> in <code>backend/</code>.</p>
                </EmptyState>
              ) : bench.state === 'ok' ? (
                <BenchmarkHeadline b={bench.data} />
              ) : null}
            </Card>

            <Card title="Forecast-error model" icon={BrainCircuit} label="Model status">
              {ml.state === 'loading' ? (
                <LoadingState label="Loading model status…" />
              ) : ml.state === 'error' ? (
                <ErrorState message={ml.message} />
              ) : ml.state === 'empty' ? (
                <EmptyState title="No model evaluation yet" />
              ) : ml.state === 'ok' ? (
                <div className="text-xs text-slate-300 space-y-1" data-testid="ml-status">
                  <div className="font-bold text-slate-100">
                    {ml.data.status === 'insufficient-data' ? 'Not trained: not enough data yet' : ml.data.status === 'evaluated-promoted' ? 'Evaluated: beat the baselines (not used for scheduling)' : 'Evaluated: did not beat the baselines'}
                  </div>
                  <div>
                    {ml.data.dataset.rows} forecast/realized pairs ({ml.data.dataset.measuredRows} measured) over {ml.data.dataset.spanDays} days.
                  </div>
                  <Link to="/results" className="text-emerald-300 underline">Details</Link>
                </div>
              ) : null}
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

const STATUS_ORDER = ['scheduled', 'running', 'completed', 'failed', 'interrupted', 'infeasible', 'cancelled', 'pending'];

const JobsSummary: React.FC<{ jobs: JobSummary[] }> = ({ jobs }) => {
  const counts = new Map<string, number>();
  for (const j of jobs) counts.set(j.status, (counts.get(j.status) ?? 0) + 1);
  const recent = [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);
  return (
    <div className="space-y-3 text-xs" data-testid="jobs-summary">
      <div className="flex flex-wrap gap-2">
        <span className="px-2 py-1 rounded bg-slate-800 text-slate-100">{jobs.length} total</span>
        {STATUS_ORDER.filter((s) => counts.has(s)).map((s) => (
          <span key={s} className="px-2 py-1 rounded border border-slate-700 text-slate-300">
            {s} {counts.get(s)}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-slate-800">
        {recent.map((j) => (
          <li key={j.id} className="py-1.5 flex justify-between gap-2">
            <span className="text-slate-200 truncate">{j.name || j.id}</span>
            <span className="text-slate-400 shrink-0">
              {j.zone ?? 'n/a'} · {j.status}
              {j.latestDecision?.dataMode === 'demo' ? ' · synthetic' : ''}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/jobs" className="text-emerald-300 underline">All jobs</Link>
    </div>
  );
};

const BenchmarkHeadline: React.FC<{ b: BenchmarkResultDetail }> = ({ b }) => (
  <div className="text-xs text-slate-300 space-y-2" data-testid="benchmark-headline">
    <div className="text-slate-400">
      {b.dataset.snapshots} real forecast snapshots, {b.dataset.realizedIntervals} realized values ({pct(b.dataset.measuredShare)} measured), synthetic workloads. Run {b.createdAt.slice(0, 16).replace('T', ' ')} UTC.
    </div>
    <table className="w-full text-left" aria-label="CarbonRoute vs Immediate">
      <thead className="text-slate-500">
        <tr>
          <th className="py-1 pr-2">Runtime CV</th>
          <th className="py-1 pr-2">Δ vs Immediate [95% CI]</th>
          <th className="py-1 pr-2">Reading</th>
          <th className="py-1">Violations (simulated)</th>
        </tr>
      </thead>
      <tbody>
        {b.scenarios.map((s) => {
          const cr = s.policies.find((p) => p.policyId === 'carbonroute_uncertainty');
          const ci = cr?.diffVsImmediateClusterCI;
          return (
            <tr key={s.runtimeCv} className="border-t border-slate-800">
              <td className="py-1 pr-2">{s.runtimeCv}</td>
              <td className="py-1 pr-2">{ci ? `${fmt(ci.estimate)} [${fmt(ci.low)}, ${fmt(ci.high)}]` : 'n/a (older result)'}</td>
              <td className="py-1 pr-2">{ci ? readDifference(ci) : 'not reported'}</td>
              <td className="py-1">{pct(cr?.deadlineViolationRate)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    <div className="text-slate-500 flex items-start gap-1">
      <Cpu className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
      Negative = cleaner than Immediate (gCO2eq/kWh, realized). Short data periods are not statistically conclusive; see Results.
    </div>
  </div>
);

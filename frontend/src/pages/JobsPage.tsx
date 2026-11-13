/**
 * My jobs (P4): list, inspect, cancel and report on the signed-in user's jobs. Every value
 * comes from the backend; when a request fails the page says so instead of showing numbers.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Download, FileJson, History, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import type { JobDetails, JobSummary, OracleEvaluation } from '../types';
import { EmptyState, ErrorState, LoadingState, SignInRequired } from '../components/StateViews';
import { DataQualityBadge } from '../components/DataQualityBadge';
import { DecisionExplanationPanel } from '../components/DecisionExplanationPanel';
import { PolicyComparisonTable } from '../components/PolicyComparisonTable';

const STATUSES = ['', 'pending', 'scheduled', 'infeasible', 'running', 'completed', 'failed', 'cancelled'] as const;
const FINISHED = new Set(['completed', 'failed', 'cancelled']);
const when = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'n/a');

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string; auth?: boolean };

export const JobsPage: React.FC = () => {
  const [status, setStatus] = useState<string>('');
  const [jobs, setJobs] = useState<Load<JobSummary[]>>({ state: 'idle' });
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Load<JobDetails>>({ state: 'idle' });
  const [oracle, setOracle] = useState<Load<OracleEvaluation>>({ state: 'idle' });
  const [actionError, setActionError] = useState<string | null>(null);
  const signedIn = api.hasSession();

  const loadJobs = useCallback(async () => {
    setJobs({ state: 'loading' });
    const res = await api.listJobs(status ? { status } : {});
    if (res.success && res.data) setJobs({ state: 'ok', data: res.data });
    else setJobs({ state: 'error', message: res.message || 'Could not load jobs.', auth: res.authRequired });
  }, [status]);

  const loadDetails = useCallback(async (id: string) => {
    setDetails({ state: 'loading' });
    setOracle({ state: 'idle' });
    setActionError(null);
    const res = await api.getJobDetails(id);
    if (res.success && res.data) setDetails({ state: 'ok', data: res.data });
    else setDetails({ state: 'error', message: res.message || 'Could not load the job.', auth: res.authRequired });
  }, []);

  useEffect(() => {
    if (signedIn) loadJobs();
  }, [signedIn, loadJobs]);

  useEffect(() => {
    if (selected) loadDetails(selected);
  }, [selected, loadDetails]);

  // A rejected session clears the token; show the server's reason before the generic prompt.
  if (jobs.state === 'error' && jobs.auth) return <Shell><SignInRequired what="your jobs" message={jobs.message} /></Shell>;
  if (!signedIn) return <Shell><SignInRequired what="your jobs" /></Shell>;

  const cancel = async (id: string) => {
    setActionError(null);
    const res = await api.cancelJob(id);
    if (!res.success) return setActionError(res.message || 'Cancel failed.');
    await Promise.all([loadJobs(), loadDetails(id)]);
  };
  const runOracle = async (id: string) => {
    setOracle({ state: 'loading' });
    const res = await api.getJobOracle(id);
    setOracle(res.success && res.data ? { state: 'ok', data: res.data } : { state: 'error', message: res.message || 'Hindsight evaluation failed.' });
  };
  const download = async (id: string, format: 'html' | 'json') => {
    setActionError(null);
    const res = await api.downloadReport(id, format);
    if (!res.success) setActionError(res.message || 'Report download failed.');
  };

  return (
    <Shell>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section aria-label="Job list" className="space-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor="job-status" className="text-xs text-slate-400">
              Status
            </label>
            <select id="job-status" value={status} onChange={(e) => setStatus(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s || 'all'}
                </option>
              ))}
            </select>
            <button type="button" onClick={loadJobs} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white" aria-label="Refresh jobs">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          {jobs.state === 'loading' || jobs.state === 'idle' ? (
            <LoadingState label="Loading your jobs…" />
          ) : jobs.state === 'error' ? (
            <ErrorState message={jobs.message} onRetry={loadJobs} />
          ) : jobs.data.length === 0 ? (
            <EmptyState title={status ? `No ${status} jobs` : 'No jobs yet'}>
              <p>
                Schedule one on the <Link className="underline" to="/prototype">Prototype</Link> page.
              </p>
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {jobs.data.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(j.id)}
                    aria-current={selected === j.id}
                    className={`w-full text-left p-3 rounded-lg border text-xs ${selected === j.id ? 'border-emerald-500 bg-emerald-950/30' : 'border-slate-800 hover:border-slate-600'}`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-bold text-slate-100">{j.name || j.id}</span>
                      <span className="text-slate-400">{j.status}</span>
                    </div>
                    <div className="text-slate-500">
                      {j.id} · {j.zone || 'n/a'} · {when(j.createdAt)}
                      {j.owner ? ` · owner ${j.owner}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Job details" className="lg:col-span-2 space-y-4">
          {!selected ? (
            <EmptyState title="Select a job to see its decision" />
          ) : details.state === 'loading' || details.state === 'idle' ? (
            <LoadingState label="Loading job…" />
          ) : details.state === 'error' ? (
            <ErrorState message={details.message} onRetry={() => loadDetails(selected)} />
          ) : (
            <Details
              d={details.data}
              oracle={oracle}
              actionError={actionError}
              onCancel={() => cancel(details.data.id)}
              onOracle={() => runOracle(details.data.id)}
              onDownload={(f) => download(details.data.id, f)}
            />
          )}
        </section>
      </div>
    </Shell>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
    <header className="space-y-1">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <History className="w-6 h-6 text-emerald-400" aria-hidden="true" /> My jobs
      </h1>
      <p className="text-sm text-slate-400">Decisions, comparisons, observations and reports for the jobs you scheduled.</p>
    </header>
    {children}
  </div>
);

const Details: React.FC<{
  d: JobDetails;
  oracle: Load<OracleEvaluation>;
  actionError: string | null;
  onCancel: () => void;
  onOracle: () => void;
  onDownload: (f: 'html' | 'json') => void;
}> = ({ d, oracle, actionError, onCancel, onOracle, onDownload }) => {
  const dec = d.decision;
  const names = Object.fromEntries((dec?.policies || []).map((p) => [p.policyId, p.policyName]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-white mr-2">{d.name || d.id}</h2>
        <span className="text-xs text-slate-400">status {d.status}</span>
        {dec && <DataQualityBadge quality={dec.dataClass === 'synthetic' ? 'synthetic' : 'forecast'}>{dec.dataClass === 'synthetic' ? 'Synthetic data' : 'Real forecast'}</DataQualityBadge>}
        <div className="ml-auto flex gap-2">
          {!FINISHED.has(d.status) && (
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-rose-700 text-rose-200 text-xs font-bold hover:bg-rose-950">
              <Ban className="w-3 h-3" /> Cancel job
            </button>
          )}
          {dec && (
            <>
              <button type="button" onClick={() => onDownload('html')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-700 text-slate-200 text-xs hover:bg-slate-800">
                <Download className="w-3 h-3" /> Report (HTML)
              </button>
              <button type="button" onClick={() => onDownload('json')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-slate-700 text-slate-200 text-xs hover:bg-slate-800">
                <FileJson className="w-3 h-3" /> Report data (JSON)
              </button>
            </>
          )}
        </div>
      </div>
      {actionError && <ErrorState message={actionError} />}

      {!dec ? (
        <EmptyState title="No scheduling decision yet" />
      ) : (
        <>
          <div className="text-xs text-slate-400 space-y-1">
            <div>
              Decision {dec.id} · {when(dec.createdAt)} · engine {dec.engineVersion} · {dec.candidateCount} candidate windows
            </div>
            {dec.provenance && (
              <div>
                Forecast from {dec.provenance.provider} for {dec.provenance.zone}, fetched {when(dec.provenance.fetchedAt)}
              </div>
            )}
            <div>Energy: {dec.energyAssumption.basis}</div>
          </div>
          {dec.status === 'INFEASIBLE' && <ErrorState message={`No recommendation: ${dec.infeasibilityReason || 'infeasible'}`} />}
          {dec.explanation && <DecisionExplanationPanel explanation={dec.explanation} policyNames={names} />}
          {dec.policies.length > 0 && <PolicyComparisonTable policies={dec.policies} dataClass={dec.dataClass} />}
        </>
      )}

      <section aria-label="Observations" className="p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
        <h3 className="font-bold text-slate-100 text-sm">Observed carbon intensity</h3>
        {!d.observations ? (
          <p className="text-slate-400">No observations collected yet. Use the Prototype page after the window has ended.</p>
        ) : (
          <>
            <p className="text-slate-300">
              {d.observations.status}: {d.observations.statusDetail}
            </p>
            <div className="flex flex-wrap gap-2">
              <DataQualityBadge quality="measured">Measured {d.observations.measured}</DataQualityBadge>
              <DataQualityBadge quality="provider-estimate">Provider estimate {d.observations.providerEstimate}</DataQualityBadge>
              <DataQualityBadge quality="missing">Missing {d.observations.missing}</DataQualityBadge>
            </div>
            <p className="text-slate-500">
              {d.observations.intervals} interval(s), collected {when(d.observations.collectedAt)}, {d.observations.attempts} attempt(s).
            </p>
          </>
        )}
      </section>

      {dec?.status === 'RECOMMENDED' && (
        <section aria-label="Hindsight evaluation" className="p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
          <h3 className="font-bold text-slate-100 text-sm">Hindsight evaluation (Oracle) — offline only</h3>
          <p className="text-slate-400">Compares the policies with the best window in hindsight, using realized observations. It is never used to make a decision.</p>
          {oracle.state === 'idle' && (
            <button type="button" onClick={onOracle} className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 hover:bg-slate-800">
              Run hindsight evaluation
            </button>
          )}
          {oracle.state === 'loading' && <LoadingState label="Evaluating…" />}
          {oracle.state === 'error' && <ErrorState message={oracle.message} />}
          {oracle.state === 'ok' && (
            <div data-testid="oracle-result" className="space-y-1">
              <div className="font-bold text-slate-200">{oracle.data.status.replace(/_/g, ' ')}</div>
              <div className="text-slate-400">{oracle.data.reason || oracle.data.basis}</div>
              {oracle.data.oracleWindow && (
                <div className="text-slate-300">
                  Best window in hindsight: {when(oracle.data.oracleWindow.startUtc)} → {when(oracle.data.oracleWindow.endUtc)}, realized {oracle.data.oracleWindow.realizedIntensity} gCO2eq/kWh
                </div>
              )}
              {oracle.data.policies && oracle.data.policies.length > 0 && (
                <ul className="list-disc pl-5 text-slate-300">
                  {oracle.data.policies.map((p) => (
                    <li key={p.policyId}>
                      {p.policyId}: realized {p.realizedIntensity ?? 'not fully observed'}
                      {p.regretGramsPerKwh !== null ? `, regret ${p.regretGramsPerKwh} gCO2eq/kWh` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default JobsPage;

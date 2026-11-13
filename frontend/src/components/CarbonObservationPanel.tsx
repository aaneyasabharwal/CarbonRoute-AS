import React from 'react';
import { Download, FileJson, RefreshCw } from 'lucide-react';
import type { JobObservationsResult, ObservationSetRecord } from '../types';

/**
 * Shows what was actually observed after the job's scheduled window, keeping four kinds of
 * data visibly separate: forecast, measured observation, provider estimate and unavailable.
 * Nothing is computed here; values come from the backend's stored observations.
 */

export const QUALITY_LABEL = {
  measured: 'Measured',
  'provider-estimate': 'Provider estimate',
  missing: 'No observation',
} as const;

export const INTENSITY_QUALITY_LABEL = {
  measured: 'Measured',
  'provider-estimate': 'Provider estimates',
  mixed: 'Mixed: measured and provider estimates',
} as const;

const QUALITY_CLASS = {
  measured: 'bg-emerald-950 text-emerald-300 border-emerald-500/40',
  'provider-estimate': 'bg-amber-950 text-amber-300 border-amber-500/40',
  missing: 'bg-slate-900 text-slate-400 border-slate-700',
} as const;

const STATUS_TEXT: Record<ObservationSetRecord['status'], string> = {
  COMPLETE: 'Observations collected for every interval',
  PARTIAL: 'Some intervals have no observation',
  PENDING_WINDOW_NOT_FINISHED: 'Waiting for the scheduled window to finish',
  UNAVAILABLE_WINDOW_MISSED: 'Unavailable: the 24-hour history window was missed',
  UNAVAILABLE_PROVIDER_ERROR: 'Unavailable: the provider request failed',
  NOT_APPLICABLE_SYNTHETIC: 'Not applicable: the decision used synthetic demo data',
};

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

export interface CarbonObservationPanelProps {
  jobId: string;
  forecastPoints?: { datetime: string; carbonIntensity: number }[];
  result: JobObservationsResult | null;
  collecting: boolean;
  error: string | null;
  onCollect: () => void;
  /** Downloads the report with the sign-in token (reports are owner/admin only, M1.2). */
  onDownloadReport: (format: 'html' | 'json') => void;
}

export const CarbonObservationPanel: React.FC<CarbonObservationPanelProps> = ({
  jobId,
  forecastPoints = [],
  result,
  collecting,
  error,
  onCollect,
  onDownloadReport,
}) => {
  const set = result?.collected ?? result?.observationSet ?? null;
  const ev = result?.evaluation ?? null;
  // Forecast values come from the stored snapshot the decision used (via the evaluation
  // pairs); a separately loaded forecast is only used for intervals without a pair.
  const forecastByTime = new Map<string, number>([
    ...forecastPoints.map((p) => [p.datetime, p.carbonIntensity] as [string, number]),
    ...(ev?.pairs || []).map((p) => [p.datetime, p.forecast] as [string, number]),
  ]);
  const obsByTime = new Map((set?.observations || []).map((o) => [o.datetime, o]));

  return (
    <div className="space-y-4 text-xs font-mono" data-testid="observation-panel">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCollect}
          disabled={collecting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${collecting ? 'animate-spin' : ''}`} />
          {set ? 'Check observations again' : 'Collect carbon observations'}
        </button>
        <button type="button" onClick={() => onDownloadReport('html')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">
          <Download className="w-4 h-4" /> Download report (HTML)
        </button>
        <button type="button" onClick={() => onDownloadReport('json')} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800">
          <FileJson className="w-4 h-4" /> Report data (JSON)
        </button>
        <span className="text-slate-500">Job {jobId}</span>
      </div>

      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}

      {set && (
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
          <div className="font-bold text-slate-100">{STATUS_TEXT[set.status]}</div>
          <p className="text-slate-400">{set.statusDetail}</p>
          <p className="text-slate-500 text-[10px]">
            Window {set.window.startUtc} → {set.window.endUtc} UTC · checked {set.collectedAt}
          </p>
        </div>
      )}

      {set && set.intervals.length > 0 && ['COMPLETE', 'PARTIAL'].includes(set.status) && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-2">Interval (your time)</th>
                <th className="p-2">Forecast (gCO2eq/kWh)</th>
                <th className="p-2">Observed (gCO2eq/kWh)</th>
                <th className="p-2">Observation type</th>
                <th className="p-2">Forecast − observed</th>
              </tr>
            </thead>
            <tbody>
              {set.intervals.map((t) => {
                const o = obsByTime.get(t);
                const f = forecastByTime.get(t);
                const kind = o ? o.quality : 'missing';
                return (
                  <tr key={t} className="border-b border-slate-900">
                    <td className="p-2 text-slate-300">{fmt(t)}</td>
                    <td className="p-2">{f ?? '—'}</td>
                    <td className="p-2">{o ? o.carbonIntensity : '—'}</td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${QUALITY_CLASS[kind]}`}>{QUALITY_LABEL[kind]}</span>
                      {o?.estimationMethod && <span className="ml-1 text-[10px] text-slate-500">{o.estimationMethod}</span>}
                    </td>
                    <td className="p-2">{o && f !== undefined ? f - o.carbonIntensity : 'not calculable'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ev && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-emerald-500/30">
            <div className="text-emerald-300 font-bold">Forecast error vs measured observations</div>
            {ev.measured ? (
              <p className="text-slate-300">
                MAE {ev.measured.mae} · RMSE {ev.measured.rmse} · bias {ev.measured.bias} gCO2eq/kWh (n={ev.measured.n})
              </p>
            ) : (
              <p className="text-slate-500">Not calculable: no measured observations in this window.</p>
            )}
          </div>
          <div className="p-3 rounded-xl bg-slate-950/70 border border-amber-500/30">
            <div className="text-amber-300 font-bold">Forecast vs provider estimates (model vs model)</div>
            {ev.providerEstimate ? (
              <p className="text-slate-300">
                MAE {ev.providerEstimate.mae} · RMSE {ev.providerEstimate.rmse} · bias {ev.providerEstimate.bias} gCO2eq/kWh (n=
                {ev.providerEstimate.n})
              </p>
            ) : (
              <p className="text-slate-500">No provider estimates in this window.</p>
            )}
          </div>
        </div>
      )}

      {result?.intensity && (
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1" data-testid="window-intensity">
          <div className="font-bold text-slate-100">Carbon intensity for the scheduled window (time-weighted)</div>
          <p className="text-slate-300">
            Forecast: {result.intensity.forecast.value ?? 'not available'}
            {result.intensity.forecast.value !== null && ' gCO2eq/kWh'} · Observed:{' '}
            {result.intensity.observed.value === null ? 'not available' : `${result.intensity.observed.value} gCO2eq/kWh`}
            {result.intensity.observed.quality && (
              <span className={`ml-2 px-2 py-0.5 rounded border text-[10px] font-bold ${QUALITY_CLASS[result.intensity.observed.quality === 'mixed' ? 'provider-estimate' : result.intensity.observed.quality]}`}>
                {INTENSITY_QUALITY_LABEL[result.intensity.observed.quality]}
              </span>
            )}
          </p>
          <p className="text-slate-500 text-[10px]">
            {result.intensity.observed.reason} Weighted by minutes: {result.intensity.observed.coveredMinutes} of{' '}
            {result.intensity.observed.windowMinutes} min covered · {result.intensity.emissionFactorType} emission factors
          </p>
        </div>
      )}

      {result?.emissions && (
        <div className="grid sm:grid-cols-2 gap-3" data-testid="emissions">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            {result.emissions.realized.available ? (
              <>
                <div className="font-bold text-emerald-300">Realized emissions (recorded energy)</div>
                <p className="text-slate-300">
                  {result.emissions.realized.grams} gCO2eq ({result.emissions.realized.energyKwh} kWh recorded)
                </p>
              </>
            ) : (
              <>
                <div className="font-bold text-slate-100">{result.emissions.realized.label}</div>
                <p className="text-slate-400">{result.emissions.realized.reason}</p>
              </>
            )}
          </div>
          <div className="p-3 rounded-xl bg-slate-950/70 border border-amber-500/30 space-y-1">
            <div className="font-bold text-amber-300">{result.emissions.estimated.label}</div>
            <p className="text-slate-300">
              {result.emissions.estimated.grams === null
                ? result.emissions.estimated.reason
                : `${result.emissions.estimated.grams} gCO2eq (estimate, not a realized emission)`}
            </p>
            <p className="text-slate-500 text-[10px]">
              Energy assumption: {result.emissions.estimated.energyKwh} kWh. {result.emissions.estimated.energyBasis}
            </p>
          </div>
        </div>
      )}

      {result?.windowComparison && (
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1" data-testid="window-comparison">
          <div className="font-bold text-slate-100">Comparison with Immediate execution (time-weighted intensity)</div>
          {result.windowComparison.available ? (
            <>
              <p className="text-slate-300">
                Observed: recommended {result.windowComparison.recommended.observedIntensity} vs Immediate{' '}
                {result.windowComparison.immediate.observedIntensity} gCO2eq/kWh (difference {result.windowComparison.observedDifference} gCO2eq/kWh,{' '}
                {result.windowComparison.observedDifferencePct}%)
              </p>
              <p className="text-slate-400">
                Forecast: recommended {result.windowComparison.recommended.forecastIntensity} vs Immediate{' '}
                {result.windowComparison.immediate.forecastIntensity} gCO2eq/kWh
              </p>
              <p className="text-slate-400">
                {result.windowComparison.estimatedEmissions.label}: {result.windowComparison.estimatedEmissions.recommendedGrams} vs{' '}
                {result.windowComparison.estimatedEmissions.immediateGrams} gCO2eq. Realized emissions: {result.windowComparison.realizedEmissions}.
              </p>
              <p className="text-slate-500 text-[10px]">{result.windowComparison.basis}</p>
            </>
          ) : (
            <p className="text-slate-400">{result.windowComparison.basis}</p>
          )}
        </div>
      )}
    </div>
  );
};

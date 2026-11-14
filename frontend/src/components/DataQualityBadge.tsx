/**
 * One visual language for where a number comes from (P4). Measured values, provider
 * estimates, forecasts, synthetic data and assumptions never share a style, so an estimate
 * cannot be mistaken for a measurement.
 */
import React from 'react';

export type DataQuality = 'measured' | 'provider-estimate' | 'forecast' | 'synthetic' | 'assumed' | 'missing';

const STYLE: Record<DataQuality, { label: string; className: string; title: string }> = {
  measured: { label: 'Measured', className: 'bg-emerald-950 border-emerald-500 text-emerald-300', title: 'Observed value reported by the provider as measured.' },
  'provider-estimate': { label: 'Provider estimate', className: 'bg-amber-950 border-amber-500 text-amber-300 border-dashed', title: 'Estimated by the provider; not a measurement.' },
  forecast: { label: 'Forecast', className: 'bg-sky-950 border-sky-500 text-sky-300', title: 'Predicted value, issued before the interval.' },
  synthetic: { label: 'Synthetic', className: 'bg-fuchsia-950 border-fuchsia-500 text-fuchsia-300', title: 'Built-in demonstration data; not real.' },
  assumed: { label: 'Assumed', className: 'bg-slate-900 border-slate-500 text-slate-300 border-dotted', title: 'Based on an assumption (e.g. energy per vCPU); not measured.' },
  missing: { label: 'Missing', className: 'bg-slate-950 border-slate-700 text-slate-500', title: 'No value; nothing is filled in.' },
};

export const DataQualityBadge: React.FC<{ quality: DataQuality; children?: React.ReactNode }> = ({ quality, children }) => {
  const s = STYLE[quality];
  return (
    <span data-quality={quality} title={s.title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${s.className}`}>
      {children ?? s.label}
    </span>
  );
};

export const DATA_QUALITY_LABEL = Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, v.label])) as Record<DataQuality, string>;

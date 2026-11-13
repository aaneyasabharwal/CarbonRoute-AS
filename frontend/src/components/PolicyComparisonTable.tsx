/**
 * Side-by-side comparison of every policy for ONE decision, using the values the backend
 * stored with that decision (P4). All intensities are forecasts; emissions use assumed
 * energy. The Oracle is never listed as a policy: it is an offline evaluation.
 */
import React from 'react';
import type { StoredPolicyRow } from '../types';
import { DataQualityBadge } from './DataQualityBadge';

const fmt = (x: number | null | undefined, dp = 1) => (x === null || x === undefined ? 'n/a' : x.toFixed(dp));
const time = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'n/a');

export const PolicyComparisonTable: React.FC<{ policies: StoredPolicyRow[]; dataClass: 'real' | 'synthetic' }> = ({ policies, dataClass }) => (
  <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      Intensities: <DataQualityBadge quality={dataClass === 'synthetic' ? 'synthetic' : 'forecast'} /> Emissions: <DataQualityBadge quality="assumed">Assumed energy</DataQualityBadge>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left" aria-label="Policy comparison">
        <thead className="text-slate-400 border-b border-slate-800">
          <tr>
            <th className="py-2 pr-3">Policy</th>
            <th className="py-2 pr-3">Window</th>
            <th className="py-2 pr-3">Forecast gCO2eq/kWh</th>
            <th className="py-2 pr-3">Est. emissions g</th>
            <th className="py-2 pr-3">Deadline-miss risk</th>
            <th className="py-2 pr-3">Delay h</th>
            <th className="py-2">Within tolerance</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) => (
            <tr key={p.policyId} className={`border-b border-slate-900 ${p.recommended ? 'bg-emerald-950/40 text-emerald-100' : 'text-slate-300'}`}>
              <td className="py-2 pr-3 font-bold">
                {p.policyName}
                {p.recommended && <span className="ml-2 text-[10px] text-emerald-300">RECOMMENDED</span>}
                {p.equivalentTo && <span className="block text-[10px] font-normal text-slate-500">same as {p.equivalentTo} (single job)</span>}
              </td>
              <td className="py-2 pr-3">
                {time(p.selectedStartUtc)} → {time(p.selectedEndUtc)}
              </td>
              <td className="py-2 pr-3">{fmt(p.forecastIntensity, 2)}</td>
              <td className="py-2 pr-3">{fmt(p.estimatedEmissionsAssumedEnergyGrams)}</td>
              <td className="py-2 pr-3">{p.estimatedDeadlineRisk === null ? 'n/a' : `${(p.estimatedDeadlineRisk * 100).toFixed(1)}%`}</td>
              <td className="py-2 pr-3">{fmt(p.waitingTimeHours, 0)}</td>
              <td className="py-2">{p.isFeasible ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

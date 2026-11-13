/**
 * Explains a scheduling decision from the backend's structured explanation (P4). Nothing here
 * is computed in the browser: every sentence comes from the decision the backend stored.
 */
import React from 'react';
import { Lightbulb } from 'lucide-react';
import type { DecisionExplanation } from '../types';

const BINDING_LABEL: Record<DecisionExplanation['bindingConstraint'], string> = {
  none: 'No constraint was binding: the lowest-forecast window is allowed.',
  'risk-tolerance': 'The deadline-risk tolerance was binding.',
  deadline: 'The deadline was binding: no window fits.',
  'data-gaps': 'Missing forecast data limited the windows that could be evaluated.',
};

export const DecisionExplanationPanel: React.FC<{ explanation: DecisionExplanation; policyNames?: Record<string, string> }> = ({ explanation, policyNames = {} }) => (
  <section aria-label="Why this decision" data-testid="decision-explanation" className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3 text-sm">
    <h4 className="flex items-center gap-2 font-bold text-slate-100">
      <Lightbulb className="w-4 h-4 text-amber-300" aria-hidden="true" /> Why this decision
    </h4>
    <p className="text-slate-200">{explanation.summary}</p>
    <p className="text-xs text-slate-400">
      <span className="font-bold text-slate-300">{BINDING_LABEL[explanation.bindingConstraint]}</span> Objective: {explanation.objective}
    </p>
    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
      {explanation.constraints.map((c) => (
        <div key={c.name} className="p-2 rounded border border-slate-800">
          <dt className="text-slate-500">{c.name}</dt>
          <dd className="text-slate-200">{c.value}</dd>
        </div>
      ))}
    </dl>
    <p className="text-xs text-slate-400">
      Candidate windows: {explanation.candidates.total} · within tolerance {explanation.candidates.feasible} · over risk tolerance{' '}
      {explanation.candidates.rejectedHighRisk} · missing forecast data {explanation.candidates.rejectedDataGap}
    </p>
    {explanation.policies.length > 0 && (
      <ul className="text-xs text-slate-300 list-disc pl-5 space-y-0.5">
        {explanation.policies.map((p) => (
          <li key={p.policyId}>
            <span className="font-bold">{policyNames[p.policyId] || p.policyId}:</span> {p.relation}
          </li>
        ))}
      </ul>
    )}
    {explanation.unavailable.length > 0 && (
      <ul className="text-xs text-slate-500 space-y-0.5">
        {explanation.unavailable.map((u) => (
          <li key={u.policyId}>
            <span className="font-bold">{u.policyName}</span> (not evaluated): {u.reason}
          </li>
        ))}
      </ul>
    )}
  </section>
);

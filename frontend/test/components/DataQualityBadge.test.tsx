/**
 * P4: measured, provider-estimated, forecast, synthetic and assumed values look different and
 * are named differently; an estimate is never labelled as measured.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DataQualityBadge, DATA_QUALITY_LABEL, DataQuality } from '../../src/components/DataQualityBadge';
import { DecisionExplanationPanel } from '../../src/components/DecisionExplanationPanel';

describe('DataQualityBadge', () => {
  it('gives every kind of value its own label and style', () => {
    const kinds: DataQuality[] = ['measured', 'provider-estimate', 'forecast', 'synthetic', 'assumed', 'missing'];
    const classes = new Set<string>();
    const labels = new Set<string>();
    for (const k of kinds) {
      const { container } = render(<DataQualityBadge quality={k} />);
      const el = container.querySelector(`[data-quality="${k}"]`)!;
      classes.add(el.className);
      labels.add(el.textContent!);
      expect(el.getAttribute('title')).toBeTruthy();
    }
    expect(classes.size).toBe(kinds.length);
    expect(labels.size).toBe(kinds.length);
    expect(DATA_QUALITY_LABEL['provider-estimate']).not.toMatch(/measured/i);
  });
});

describe('DecisionExplanationPanel', () => {
  it('renders the backend explanation, the binding constraint and unavailable policies with reasons', () => {
    const { container } = render(
      <DecisionExplanationPanel
        explanation={{
          objective: 'Minimise forecast carbon intensity.',
          constraints: [{ name: 'Deadline-miss risk', value: 'at most 5.0%' }],
          candidates: { total: 7, feasible: 4, rejectedHighRisk: 3, rejectedDataGap: 0 },
          bindingConstraint: 'risk-tolerance',
          summary: 'The lowest-forecast window has a deadline-miss risk of 50.0%, above the tolerance.',
          policies: [{ policyId: 'deterministic_carbon', relation: '50.00 gCO2eq/kWh lower forecast than CarbonRoute, but above the risk tolerance.' }],
          unavailable: [{ policyId: 'cost_aware', policyName: 'Cost-Aware', reason: 'No electricity-price data provider is configured.' }],
        }}
        policyNames={{ deterministic_carbon: 'Greedy' }}
      />
    );
    expect(container).toHaveTextContent('The deadline-risk tolerance was binding.');
    expect(container).toHaveTextContent('over risk tolerance 3');
    expect(container).toHaveTextContent('Greedy: 50.00 gCO2eq/kWh lower forecast');
    expect(container).toHaveTextContent('Cost-Aware (not evaluated): No electricity-price data provider');
  });
});

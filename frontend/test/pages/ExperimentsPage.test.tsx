/**
 * Experiments page (P8): describes the evaluation design honestly. Each metric is marked implemented,
 * implemented with a qualification, or planned; results are linked, never shown as numbers here.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExperimentsPage } from '../../src/pages/ExperimentsPage';

describe('ExperimentsPage', () => {
  it('marks each metric with its real status and points to the Results page', () => {
    render(<MemoryRouter><ExperimentsPage /></MemoryRouter>);
    expect(screen.getAllByTestId('metric-status-planned')).toHaveLength(3); // Brier, ECE, reliability
    expect(screen.getAllByTestId('metric-status-qualified')).toHaveLength(3); // estimated emissions, paired difference, simulated violations
    expect(screen.getAllByTestId('metric-status-implemented')).toHaveLength(1); // delay
    expect(screen.getAllByTestId('metric-status-qualified')[0]).toHaveTextContent('ESTIMATED emissions');
    expect(screen.getAllByTestId('metric-status-planned')[0]).toHaveTextContent('recorded runtimes');
    expect(screen.getAllByRole('link', { name: /Results/ }).every((a) => a.getAttribute('href') === '/results')).toBe(true);
    expect(document.body.textContent).not.toMatch(/Phase 7|under construction/);
  });
});

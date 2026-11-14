/**
 * Smoke test: every route in src/App.tsx renders without crashing while the
 * backend is unreachable (fetch rejects; see test/setup.ts). This protects
 * existing pages while later milestones change them.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App';

const ROUTES = [
  '/',
  '/project',
  '/how-it-works',
  '/architecture',
  '/scheduler',
  '/jobs',
  '/results',
  '/experiments',
  '/system-design',
  '/roadmap',
  '/team',
  '/resources',
  '/presentations',
  '/presentations/planning/v1',
  '/presentation/v1',
  '/dashboard',
  '/account',
  '/admin',
];

describe('App routes render without crashing (backend unreachable)', () => {
  it.each(ROUTES)('%s', async (route) => {
    window.history.pushState({}, '', route);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = render(<App />);

    // Navbar, page content and footer are present.
    expect(container.querySelector('nav')).not.toBeNull();
    expect(container.querySelector('main')).not.toBeNull();
    expect(container.querySelector('footer')).not.toBeNull();
    await waitFor(() => expect(container.querySelector('main')!.textContent!.trim().length).toBeGreaterThan(0));
    expect(screen.getAllByText(/CarbonRoute/i).length).toBeGreaterThan(0);

    // React render errors are reported through console.error; logged fetch
    // failures from the unreachable backend are expected and allowed.
    const renderErrors = errors.mock.calls.filter((c) =>
      /The above error occurred|Uncaught|is not a function|Cannot read properties/.test(String(c[0]))
    );
    expect(renderErrors).toEqual([]);
  });

  // P14: the page was renamed from Prototype to Scheduler; old links keep working.
  it('/prototype redirects to /scheduler', async () => {
    window.history.pushState({}, '', '/prototype');
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/scheduler'));
  });

  // P14: the word "prototype" is no longer shown anywhere in the application.
  it.each(ROUTES)('%s shows no "prototype" wording', async (route) => {
    window.history.pushState({}, '', route);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('main')!.textContent!.trim().length).toBeGreaterThan(0));
    expect(container.textContent).not.toMatch(/prototype/i);
  });

  it('unknown routes redirect to the home page', async () => {
    window.history.pushState({}, '', '/no-such-page');
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });
});

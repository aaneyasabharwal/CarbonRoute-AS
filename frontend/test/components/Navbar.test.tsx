/**
 * P11 responsive navigation. Before P11 all 14 links sat in one desktop row: at 1366-1440 px four
 * labels wrapped, five items (including Sign in) were beyond the viewport and the page scrolled
 * sideways. Layout is verified in a real browser (docs/VALIDATION_REPORT.md); these tests check that
 * every destination stays reachable and the menus behave.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/context/AuthContext';
import { Navbar, PRIMARY_LINKS, PROJECT_LINKS } from '../../src/components/Navbar';
import { stubFetch } from '../support/fetch';

const renderNav = (path = '/') =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Navbar />
      </MemoryRouter>
    </AuthProvider>
  );

beforeEach(() => {
  localStorage.removeItem('carbonroute_token');
  stubFetch(() => undefined);
});

describe('Navbar', () => {
  it('every page is a destination: 5 application links and 9 project links', () => {
    expect(PRIMARY_LINKS.map((l) => l.path)).toEqual(['/dashboard', '/prototype', '/jobs', '/results', '/experiments']);
    expect(PROJECT_LINKS).toHaveLength(9);
    expect(new Set([...PRIMARY_LINKS, ...PROJECT_LINKS].map((l) => l.path)).size).toBe(14);
  });

  it('desktop: primary links never wrap, and "More" opens a menu with every project page and closes on Escape', () => {
    renderNav('/dashboard');
    const main = screen.getAllByRole('navigation', { name: 'Main' })[0];
    for (const l of PRIMARY_LINKS) {
      const a = within(main).getByRole('link', { name: l.name });
      expect(a.className).toMatch(/whitespace-nowrap/);
    }
    expect(within(main).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    const more = within(main).getByRole('button', { name: /More/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = document.getElementById('nav-more-menu')!;
    for (const l of PROJECT_LINKS) expect(within(menu).getByRole('link', { name: l.name })).toHaveAttribute('href', l.path);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('nav-more-menu')).toBeNull();
  });

  // P13 regression: a second "Launch Prototype" button (>= 1536 px) overlapped "More" when signed in
  // with a long username (measured in a browser). The highlighted Prototype link is the only one.
  it('has a single Prototype link in the bar (no duplicate button that could overlap More)', () => {
    renderNav('/dashboard');
    const header = document.querySelector('header')!;
    const links = [...header.querySelectorAll('a[href="/prototype"]')].filter((a) => !a.closest('#mobile-menu'));
    expect(links).toHaveLength(1);
    expect(header.textContent).not.toMatch(/Launch Prototype/);
  });

  it('mobile: the menu button toggles a menu with all 14 destinations and Sign in', () => {
    renderNav('/');
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    const menu = document.getElementById('mobile-menu')!;
    for (const l of [...PRIMARY_LINKS, ...PROJECT_LINKS]) expect(within(menu).getByRole('link', { name: l.name })).toHaveAttribute('href', l.path);
    expect(within(menu).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('mobile-menu')).toBeNull();
  });
});

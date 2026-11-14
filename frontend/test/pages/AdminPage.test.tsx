/**
 * Sign-in page (/admin) (P9). Every account signs in here, but only administrators get the content
 * manager. Before P9 a student who signed in saw "Admin Active" and upload buttons whose requests the
 * backend then refused (403).
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/context/AuthContext';
import { AdminPage } from '../../src/pages/AdminPage';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

const student = { id: 'u1', username: 'alice', email: 'alice@example.org', role: 'student' };
const admin = { id: 'u0', username: 'root', email: 'root@example.org', role: 'admin' };

function backend(user: unknown) {
  return stubFetch((url) => {
    if (url === `${API_BASE}/auth/me`) return { body: { success: true, user } };
    if (url.startsWith(`${API_BASE}/presentations`) || url.startsWith(`${API_BASE}/resources`)) return { body: { success: true, data: [] } };
    return undefined;
  });
}
const renderPage = () =>
  render(
    <AuthProvider>
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    </AuthProvider>
  );

beforeEach(() => localStorage.removeItem('carbonroute_token'));

describe('AdminPage (sign-in and content manager)', () => {
  it('signed out: one sign-in form for every account', async () => {
    backend(null);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/Sign In as Admin/)).toBeNull();
  });

  it('a signed-in student is not shown the content manager and makes no admin requests', async () => {
    localStorage.setItem('carbonroute_token', 'student-token');
    const fetchMock = backend(student);
    renderPage();
    const panel = await screen.findByTestId('signed-in-non-admin');
    expect(panel).toHaveTextContent('alice');
    expect(panel).toHaveTextContent(/administrators/);
    expect(screen.getByRole('link', { name: /My jobs/ })).toHaveAttribute('href', '/jobs');
    expect(screen.queryByText(/Admin Active/)).toBeNull();
    expect(screen.queryByText(/Upload Deliverable/)).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith(`${API_BASE}/resources/all`))).toBe(false);
  });

  it('an administrator gets the content manager', async () => {
    localStorage.setItem('carbonroute_token', 'admin-token');
    backend(admin);
    renderPage();
    expect(await screen.findByText(/Admin Active: root/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Upload Deliverable/).length).toBeGreaterThan(0));
  });
});

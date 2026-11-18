/**
 * P22: administrators see each account's verification state and can resend a code or confirm an
 * address manually; the admin area says plainly when the server's storage is temporary.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/context/AuthContext';
import { AccountPage } from '../../src/pages/AccountPage';
import { PersistenceNotice } from '../../src/components/PersistenceNotice';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

const admin = { id: 'u0', username: 'root', email: 'root@example.org', role: 'admin', emailVerified: true };
const users = [
  { ...admin, emailVerificationMethod: 'admin-bootstrap', lastCodeDelivery: null },
  { id: 'u1', username: 'alice', email: 'alice@example.org', role: 'student', emailVerified: false, lastCodeDelivery: { delivery: 'not-configured', at: '2026-11-18T10:00:00Z' } },
  { id: 'u2', username: 'bob', email: 'bob@example.org', role: 'student', emailVerified: true, emailVerificationMethod: 'otp', lastCodeDelivery: null },
];

beforeEach(() => {
  localStorage.setItem('carbonroute_token', 'admin-token');
  vi.stubGlobal('confirm', () => true);
});

describe('account list verification column', () => {
  it('shows the state from the backend and offers actions only for unverified accounts', async () => {
    const calls: string[] = [];
    stubFetch((url, init) => {
      if (url === `${API_BASE}/auth/me`) return { body: { success: true, user: admin } };
      if (url === `${API_BASE}/admin/users`) return { body: { success: true, data: users } };
      if (url.endsWith('/verify-email') && init?.method === 'POST') {
        calls.push(url);
        return { body: { success: true, message: 'alice marked as verified by an administrator.' } };
      }
      return undefined;
    });
    render(
      <AuthProvider>
        <MemoryRouter>
          <AccountPage />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(await screen.findByTestId('verified-alice')).toHaveTextContent('no, last code not sent (no email provider)');
    expect(screen.getByTestId('verified-bob')).toHaveTextContent('yes');
    expect(screen.getByTestId('verified-root')).toHaveTextContent('yes (server administrator)');
    expect(screen.getAllByRole('button', { name: 'Confirm manually' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm manually' }));
    await waitFor(() => expect(calls).toEqual([`${API_BASE}/admin/users/u1/verify-email`]));
    expect(await screen.findByText('alice marked as verified by an administrator.')).toBeInTheDocument();
  });
});

describe('PersistenceNotice', () => {
  it('warns when the server stores data on a temporary disk', async () => {
    stubFetch(() => ({ body: { persistence: { mode: 'local-file', durable: false, startedAt: '2026-11-18T10:00:00Z', note: 'Data is stored on this server\'s local disk.' } } }));
    render(<PersistenceNotice />);
    expect(await screen.findByTestId('persistence-notice')).toHaveTextContent('Temporary storage');
  });

  it('shows nothing when storage is durable', async () => {
    const f = stubFetch(() => ({ body: { persistence: { mode: 'postgres', durable: true, startedAt: '2026-11-18T10:00:00Z', note: '' } } }));
    render(<PersistenceNotice />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.queryByTestId('persistence-notice')).toBeNull();
  });
});

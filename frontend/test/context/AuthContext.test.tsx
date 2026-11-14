import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

let auth: ReturnType<typeof useAuth>;

const Probe: React.FC = () => {
  auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="user">{auth.user?.username ?? 'none'}</span>
      <span data-testid="admin">{String(auth.isAdmin)}</span>
    </div>
  );
};

const renderProbe = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

describe('AuthContext', () => {
  it('useAuth outside the provider throws a clear error', () => {
    const Lonely = () => {
      useAuth();
      return null;
    };
    // React also logs the thrown error; silence it, the assertion is on the throw itself.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Lonely />)).toThrow('useAuth must be used within an AuthProvider');
  });

  it('finishes loading with no user when there is no stored token', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('restores the session from a stored token', async () => {
    localStorage.setItem('carbonroute_token', 'tok');
    stubFetch((url) =>
      url === `${API_BASE}/auth/me` ? { body: { success: true, user: { id: 'u1', username: 'alice', role: 'admin' } } } : undefined
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('alice'));
    expect(screen.getByTestId('admin')).toHaveTextContent('true');
  });

  it('drops a stored token the backend rejects', async () => {
    localStorage.setItem('carbonroute_token', 'bad');
    stubFetch(() => ({ status: 403, body: { success: false } }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });

  it('login sets the user; logout clears it', async () => {
    stubFetch((url) =>
      url === `${API_BASE}/auth/login`
        ? { body: { success: true, token: 'tok-1', user: { id: 'u2', username: 'bob', role: 'student' } } }
        : url === `${API_BASE}/auth/logout`
          ? { body: { success: true } }
          : undefined
    );
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    let result: { success: boolean } | undefined;
    await act(async () => {
      result = await auth.login('bob', 'pw');
    });
    expect(result?.success).toBe(true);
    expect(screen.getByTestId('user')).toHaveTextContent('bob');
    expect(screen.getByTestId('admin')).toHaveTextContent('false');

    await act(async () => {
      await auth.logout();
    });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });

  it('a failed login leaves the user signed out with the backend message', async () => {
    stubFetch(() => ({ status: 401, body: { success: false, message: 'Invalid credentials.' } }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    let result: { success: boolean; message?: string } | undefined;
    await act(async () => {
      result = await auth.login('bob', 'wrong');
    });
    expect(result).toEqual({ success: false, message: 'Invalid credentials.' });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });
});

/**
 * P22: the verification step after a correct password. The backend decides; the component only
 * sends what the user typed and shows the answers.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmailVerification } from '../../src/components/EmailVerification';
import { AuthProvider } from '../../src/context/AuthContext';
import { AdminPage } from '../../src/pages/AdminPage';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';
import type { EmailVerificationChallenge } from '../../src/types';

const challenge: EmailVerificationChallenge = {
  verificationTicket: 'ticket-1',
  maskedEmail: 'al***@example.org',
  delivery: 'sent',
  detail: 'A 6-digit code was emailed. It expires in 5 minutes.',
  retryAfterSeconds: 0,
};

beforeEach(() => localStorage.removeItem('carbonroute_token'));

describe('EmailVerification', () => {
  it('shows where the code went, accepts digits only, and signs in on success', async () => {
    const user = { id: 'u', username: 'alice', email: 'alice@example.org', role: 'student' as const, emailVerified: true };
    stubFetch((url) => (url === `${API_BASE}/auth/verify-email/confirm` ? { body: { success: true, token: 'tok', user } } : undefined));
    const onVerified = vi.fn();
    render(<EmailVerification challenge={challenge} onVerified={onVerified} onCancel={() => {}} />);
    expect(screen.getByText(/al\*\*\*@example\.org/)).toBeInTheDocument();
    expect(screen.getByTestId('verification-delivery')).toHaveTextContent('A 6-digit code was emailed');
    const input = screen.getByLabelText('6-digit verification code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12a3-4567' } });
    expect(input.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith('tok', user));
  });

  it('shows the backend message for an incorrect or expired code', async () => {
    stubFetch(() => ({ status: 400, body: { success: false, code: 'OTP_EXPIRED', message: 'This code has expired. Request a new code.' } }));
    render(<EmailVerification challenge={challenge} onVerified={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('6-digit verification code'), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This code has expired');
  });

  it('is honest when no email could be sent', () => {
    render(
      <EmailVerification
        challenge={{ ...challenge, delivery: 'not-configured', detail: 'No code could be sent: email delivery is not configured on this server.' }}
        onVerified={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByTestId('verification-delivery')).toHaveTextContent('not configured');
  });

  it('the resend button waits for the cooldown', () => {
    render(<EmailVerification challenge={{ ...challenge, retryAfterSeconds: 30 }} onVerified={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /Send a new code in 30s/ })).toBeDisabled();
  });
});

describe('sign-in page with an unverified account', () => {
  it('a correct password leads to the verification step, and a correct code signs in', async () => {
    const user = { id: 'u', username: 'alice', email: 'alice@example.org', role: 'student', emailVerified: true };
    stubFetch((url) => {
      if (url === `${API_BASE}/auth/login`) {
        return {
          status: 403,
          body: { success: false, code: 'EMAIL_NOT_VERIFIED', message: 'Verify', verificationTicket: 'ticket-1', maskedEmail: 'al***@example.org', delivery: 'sent', detail: 'A 6-digit code was emailed.' },
        };
      }
      if (url === `${API_BASE}/auth/verify-email/confirm`) return { body: { success: true, token: 'tok', user } };
      if (url === `${API_BASE}/health`) return { body: { persistence: { mode: 'postgres', durable: true, startedAt: '2026-11-18T00:00:00Z', note: '' } } };
      return undefined;
    });
    render(
      <AuthProvider>
        <MemoryRouter>
          <AdminPage />
        </MemoryRouter>
      </AuthProvider>
    );
    fireEvent.change(await screen.findByPlaceholderText('Enter username or email'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'pw-123456789012' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('email-verification')).toBeInTheDocument();
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
    fireEvent.change(screen.getByLabelText('6-digit verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByTestId('signed-in-non-admin')).toBeInTheDocument();
    expect(localStorage.getItem('carbonroute_token')).toBe('tok');
  });
});

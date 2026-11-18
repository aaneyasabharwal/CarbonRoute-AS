/**
 * P22: the client reads persisted data from the backend on every load, reports failed loads
 * instead of showing empty or old lists, keeps the session when the server is only slow, and handles
 * the email-verification step. fetch is stubbed; no test reaches a real backend.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { api, API_BASE } from '../../src/services/api';
import { stubFetch, bodyOf } from '../support/fetch';

beforeEach(() => localStorage.removeItem('carbonroute_token'));

describe('lists are always read fresh from the backend', () => {
  it('resources, the admin resource list and the account list bypass the browser cache', async () => {
    localStorage.setItem('carbonroute_token', 't');
    const fetchMock = stubFetch(() => ({ body: { success: true, data: [] } }));
    await api.getResources();
    await api.getAllResourcesAdmin();
    await api.listUsers();
    await api.getMe();
    for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit).cache).toBe('no-store');
  });

  it('a failed admin resource load is reported, not shown as an empty list', async () => {
    localStorage.setItem('carbonroute_token', 't');
    stubFetch(() => ({ status: 500, body: { success: false, message: 'boom' } }));
    expect(await api.getAllResourcesAdmin()).toEqual({ success: false, message: 'boom' });
    stubFetch(() => undefined);
    const r = await api.getAllResourcesAdmin();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not reachable/);
  });

  it('an HTTP error on the public list is reported too', async () => {
    stubFetch(() => ({ status: 503, body: { success: false, message: 'Service unavailable' } }));
    expect(await api.getResources()).toEqual({ success: false, message: 'Service unavailable' });
  });
});

describe('the session survives a slow or unreachable server', () => {
  it('keeps the token when the server cannot be reached (e.g. a cold start)', async () => {
    localStorage.setItem('carbonroute_token', 'keep-me');
    stubFetch(() => undefined);
    const r = await api.getMe();
    expect(r.success).toBe(false);
    expect(localStorage.getItem('carbonroute_token')).toBe('keep-me');
  });

  it('keeps it on a server error, removes it only when the server rejects it', async () => {
    localStorage.setItem('carbonroute_token', 'keep-me');
    stubFetch(() => ({ status: 502, body: null }));
    await api.getMe();
    expect(localStorage.getItem('carbonroute_token')).toBe('keep-me');
    stubFetch(() => ({ status: 401, body: { success: false, message: 'Invalid authentication token.' } }));
    const r = await api.getMe();
    expect(r.authRequired).toBe(true);
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });
});

describe('email verification', () => {
  const challenge = {
    success: false,
    code: 'EMAIL_NOT_VERIFIED',
    message: 'Verify your email address to finish signing in.',
    verificationTicket: 'ticket-1',
    maskedEmail: 'al***@example.org',
    delivery: 'sent',
    detail: 'A 6-digit code was emailed.',
    retryAfterSeconds: 60,
  };

  it('a correct password on an unverified account returns the challenge and stores no token', async () => {
    stubFetch(() => ({ status: 403, body: challenge }));
    const r = await api.login('alice', 'pw');
    expect(r.success).toBe(false);
    expect(r.verification).toEqual({
      verificationTicket: 'ticket-1',
      maskedEmail: 'al***@example.org',
      delivery: 'sent',
      detail: 'A 6-digit code was emailed.',
      retryAfterSeconds: 60,
    });
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });

  it('a 403 without the verification code is an ordinary failure', async () => {
    stubFetch(() => ({ status: 403, body: { success: false, message: 'Forbidden' } }));
    const r = await api.login('alice', 'pw');
    expect(r.verification).toBeUndefined();
    expect(r.message).toBe('Forbidden');
  });

  it('confirming sends the ticket and code to the backend and stores the session only on success', async () => {
    const fetchMock = stubFetch(() => ({ status: 400, body: { success: false, code: 'OTP_INCORRECT', message: 'Incorrect code. 4 attempts left.', attemptsLeft: 4 } }));
    const bad = await api.confirmVerificationCode('ticket-1', '000000');
    expect(bad).toMatchObject({ success: false, code: 'OTP_INCORRECT', attemptsLeft: 4 });
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE}/auth/verify-email/confirm`);
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ verificationTicket: 'ticket-1', code: '000000' });

    stubFetch(() => ({ body: { success: true, token: 'tok', user: { id: 'u', username: 'alice', email: 'a@example.org', role: 'student', emailVerified: true } } }));
    const ok = await api.confirmVerificationCode('ticket-1', '123456');
    expect(ok.success).toBe(true);
    expect(localStorage.getItem('carbonroute_token')).toBe('tok');
  });

  it('resend reports rate limits and the delivery state as given by the backend', async () => {
    stubFetch(() => ({ status: 429, body: { success: false, code: 'RATE_LIMITED', message: 'Please wait 42 seconds.', delivery: 'rate-limited', retryAfterSeconds: 42 } }));
    expect(await api.resendVerificationCode('ticket-1')).toMatchObject({ success: false, code: 'RATE_LIMITED', retryAfterSeconds: 42 });
    stubFetch(() => ({ status: 202, body: { success: true, delivery: 'not-configured', detail: 'No code could be sent.' } }));
    expect(await api.resendVerificationCode('ticket-1')).toMatchObject({ success: true, delivery: 'not-configured', detail: 'No code could be sent.' });
  });

  it('account creation passes on what happened to the first code', async () => {
    localStorage.setItem('carbonroute_token', 't');
    stubFetch(() => ({ status: 201, body: { success: true, data: { id: 'n', username: 'bob' }, verification: { delivery: 'failed', detail: 'The email could not be sent.' } } }));
    expect(await api.createUser({ username: 'bob', email: 'b@example.org', password: 'x'.repeat(12), role: 'student' })).toMatchObject({
      success: true,
      delivery: 'failed',
      detail: 'The email could not be sent.',
    });
  });
});

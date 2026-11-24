/**
 * P22: email verification with one-time codes.
 *
 * Codes are captured from the development console provider's in-memory outbox (nothing is sent),
 * which exists only outside production (see the provider tests at the end).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../src/app';
import { db } from '../../src/models/db';
import { loginAsTestAdmin } from '../support/auth';
import {
  BrevoEmailProvider,
  ConsoleEmailProvider,
  NoEmailProvider,
  emailProviderFromEnv,
  setEmailProvider,
} from '../../src/services/emailProvider';
import {
  generateOtp,
  hashOtp,
  issueVerificationCode,
  verifyCode,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
} from '../../src/services/otpService';
import { issueAccessToken, issueVerificationTicket } from '../../src/middleware/auth';
import { checkMailDomain, emailSyntaxProblem, type MailResolver } from '../../src/services/emailValidation';

let outbox: ConsoleEmailProvider;
const PASSWORD = 'Student-pass-1234';

beforeEach(() => {
  outbox = new ConsoleEmailProvider(false);
  setEmailProvider(outbox);
});
afterEach(() => {
  vi.useRealTimers();
  setEmailProvider(null);
});

const codeIn = (i = outbox.outbox.length - 1) => /\b(\d{6})\b/.exec(outbox.outbox[i].text)![1];
const newUser = () => {
  const username = `otp-${crypto.randomBytes(4).toString('hex')}`;
  return db.createUser({ username, email: `${username}@example.org`, password: PASSWORD, role: 'student' });
};
/** Signs in with the correct password; for an unverified account this returns the ticket. */
const signIn = (username: string, password = PASSWORD) => request(app).post('/api/auth/login').send({ username, password });
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('code generation and storage', () => {
  it('codes are 6 digits, uniformly drawn, and only an HMAC bound to the account is stored', async () => {
    const codes = Array.from({ length: 2000 }, generateOtp);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1990);
    const leading = codes.filter((c) => c.startsWith('0')).length;
    expect(leading).toBeGreaterThan(120); // ~10 % expected: zero-padding is not lost
    const u = newUser();
    const r = await issueVerificationCode(u);
    expect(r).toMatchObject({ status: 'issued', delivery: 'simulated' });
    const code = codeIn();
    const rec = db.getEmailOtps().find((o) => o.userId === u.id)!;
    expect(rec.codeHash).toBe(hashOtp(u.id, code));
    expect(rec.codeHash).not.toContain(code);
    expect(JSON.stringify(db.snapshot())).not.toMatch(new RegExp(`"${code}"`));
    // Bound to the account: the same code hashes differently for another account.
    expect(hashOtp('another-user', code)).not.toBe(rec.codeHash);
    expect(Date.parse(rec.expiresAt) - Date.parse(rec.createdAt)).toBe(OTP_TTL_MS);
    expect(outbox.outbox.at(-1)!.to).toBe(u.email);
  });
});

describe('sign-in and verification flow (API)', () => {
  it('an unverified account cannot sign in; the code verifies it and signs it in; verified accounts sign in normally', async () => {
    const u = newUser();
    const first = await signIn(u.username);
    expect(first.status).toBe(403);
    expect(first.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', delivery: 'simulated' });
    expect(first.body.token).toBeUndefined();
    expect(first.body.maskedEmail).toMatch(/^ot\*\*\*@example\.org$/);
    const code = codeIn();
    // The code is never in an API response.
    expect(JSON.stringify(first.body)).not.toContain(code);

    const ok = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket: first.body.verificationTicket, code });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ username: u.username, emailVerified: true });
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ok.body.token}`)).status).toBe(200);

    // Verification persists in the database and a normal sign-in now works.
    expect(db.getUserById(u.id)).toMatchObject({ emailVerified: true, emailVerificationMethod: 'otp' });
    expect((await signIn(u.username)).status).toBe(200);
  });

  it('rejects incorrect codes with the attempts left, and locks the code after the limit', async () => {
    const u = newUser();
    const { verificationTicket } = (await signIn(u.username)).body;
    const code = codeIn();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 1; i < OTP_MAX_FAILED_ATTEMPTS; i++) {
      const r = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket, code: wrong });
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'OTP_INCORRECT', attemptsLeft: OTP_MAX_FAILED_ATTEMPTS - i });
    }
    const locked = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket, code: wrong });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    // Even the right code no longer works once the code is locked.
    const after = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket, code });
    expect(after.status).toBe(400);
    expect(after.body.code).toBe('OTP_NO_CODE');
    expect(db.getUserById(u.id)!.emailVerified).toBe(false);
  });

  it('rejects malformed input without counting it as a guess', async () => {
    const u = newUser();
    const { verificationTicket } = (await signIn(u.username)).body;
    for (const code of ['12345', '1234567', 'abcdef', '', null, 123456]) {
      const r = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket, code });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('OTP_MALFORMED');
    }
    expect(db.getEmailOtps().find((o) => o.userId === u.id && !o.consumedAt)!.failedAttempts).toBe(0);
  });

  it('rejects an expired code (after 5 minutes)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const u = newUser();
    const { verificationTicket } = (await signIn(u.username)).body;
    const code = codeIn();
    advance(OTP_TTL_MS + 1000);
    const r = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket, code });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('OTP_EXPIRED');
    expect(db.getUserById(u.id)!.emailVerified).toBe(false);
  });

  it('a code is single use', async () => {
    const u = newUser();
    await issueVerificationCode(u);
    const code = codeIn();
    expect(verifyCode(u, code).ok).toBe(true);
    // Put the account back to unverified to show the used code cannot be replayed.
    db.getUserById(u.id)!.emailVerified = false;
    expect(verifyCode(u, code)).toMatchObject({ ok: false, reason: 'no-code' });
  });

  it('a new code invalidates the previous one; resends are limited (60 s cooldown, 5 per hour)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const u = newUser();
    const { verificationTicket } = (await signIn(u.username)).body;
    const oldCode = codeIn();
    const soon = await request(app).post('/api/auth/verify-email/resend').send({ verificationTicket });
    expect(soon.status).toBe(429);
    expect(soon.body.retryAfterSeconds).toBeGreaterThan(0);

    advance(OTP_RESEND_COOLDOWN_MS + 1);
    const again = await request(app).post('/api/auth/verify-email/resend').send({ verificationTicket });
    expect(again.status).toBe(202);
    const newCode = codeIn();
    if (newCode !== oldCode) {
      const old = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket, code: oldCode });
      expect(old.status).toBe(400);
    }
    // Codes 3, 4 and 5 within the hour are allowed; the 6th is refused.
    for (let i = 0; i < 3; i++) {
      advance(OTP_RESEND_COOLDOWN_MS + 1);
      expect((await request(app).post('/api/auth/verify-email/resend').send({ verificationTicket })).status).toBe(202);
    }
    advance(OTP_RESEND_COOLDOWN_MS + 1);
    const sixth = await request(app).post('/api/auth/verify-email/resend').send({ verificationTicket });
    expect(sixth.status).toBe(429);
    expect(sixth.body.message).toMatch(/Too many codes/);
    // The newest code still works.
    const ok = await request(app).post('/api/auth/verify-email/confirm').send({ verificationTicket, code: codeIn() });
    expect(ok.status).toBe(200);
  });

  it('an attempt with no provider configured does not start a cooldown or claim a code was sent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const u = newUser();
    setEmailProvider(new NoEmailProvider());
    for (let i = 0; i < 6; i++) expect(await issueVerificationCode(u)).toMatchObject({ status: 'issued', delivery: 'not-configured' });
    // Once delivery works, a code goes out at once.
    setEmailProvider(outbox);
    const before = outbox.outbox.length;
    expect(await issueVerificationCode(u)).toMatchObject({ status: 'issued', delivery: 'simulated' });
    expect(outbox.outbox.length).toBe(before + 1);
  });

  it('after a failed send the cooldown message says the attempt failed, not that a code was sent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const u = newUser();
    setEmailProvider({ name: 'broken', send: async () => ({ status: 'failed', provider: 'broken', error: 'Provider not reachable.' }) } as any);
    expect(await issueVerificationCode(u)).toMatchObject({ status: 'issued', delivery: 'failed' });
    const soon = await issueVerificationCode(u);
    expect(soon).toMatchObject({ status: 'rate-limited' });
    expect((soon as any).message).toMatch(/attempt to send a code failed/);
    expect((soon as any).message).not.toMatch(/was sent/);
  });
});

describe('security boundaries', () => {
  it('a wrong password on an unverified account looks exactly like any failed sign-in (no enumeration, no code sent)', async () => {
    const u = newUser();
    const before = outbox.outbox.length;
    const wrong = await signIn(u.username, 'wrong-password-123');
    const unknown = await signIn('no-such-user-xyz', 'wrong-password-123');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(outbox.outbox.length).toBe(before);
  });

  it('verification needs a valid ticket; tickets and access tokens are not interchangeable', async () => {
    const u = newUser();
    expect((await request(app).post('/api/auth/verify-email/confirm').send({ code: '123456' })).status).toBe(401);
    expect((await request(app).post('/api/auth/verify-email/resend').send({ verificationTicket: 'forged' })).status).toBe(401);
    // A ticket is not an access token.
    const ticket = issueVerificationTicket(u);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ticket}`)).status).toBe(401);
    // An access token is not a ticket.
    const admin = db.getUsers().find((x) => x.role === 'admin')!;
    const access = issueAccessToken(admin);
    expect((await request(app).post('/api/auth/verify-email/resend').send({ verificationTicket: access })).status).toBe(401);
  });

  it('verification is enforced on every request: a token of an unverified account is refused (403)', async () => {
    const u = newUser();
    const forged = issueAccessToken(u); // e.g. a token issued before this change
    const r = await request(app).get('/api/jobs').set('Authorization', `Bearer ${forged}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('only administrators may attest an address, and only with an explicit confirmation', async () => {
    const u = newUser();
    const A = { Authorization: `Bearer ${await loginAsTestAdmin(app)}` };
    const studentAccount = db.createUser(
      { username: `s-${crypto.randomBytes(3).toString('hex')}`, email: 'st@example.org', password: PASSWORD, role: 'student' },
      'test',
      { verifiedBy: 'operator-cli' }
    );
    const S = { Authorization: `Bearer ${issueAccessToken(studentAccount)}` };
    expect((await request(app).post(`/api/admin/users/${u.id}/verify-email`).send({ confirm: true })).status).toBe(401);
    expect((await request(app).post(`/api/admin/users/${u.id}/verify-email`).set(S).send({ confirm: true })).status).toBe(403);
    expect((await request(app).post(`/api/admin/users/${u.id}/verify-email`).set(A).send({})).status).toBe(400);
    expect((await request(app).post(`/api/admin/users/${u.id}/verify-email`).set(A).send({ confirm: true })).status).toBe(200);
    expect(db.getUserById(u.id)).toMatchObject({ emailVerified: true, emailVerificationMethod: 'admin-attested' });
    const logs = (await request(app).get('/api/admin/audit-logs').set(A)).body.data;
    expect(logs.some((l: { action: string; details: string }) => l.action === 'EMAIL_VERIFIED' && l.details.includes('admin-attested'))).toBe(true);
  });

  it('admin-created accounts start unverified and receive a code; the admin list shows status, never codes or hashes', async () => {
    const A = { Authorization: `Bearer ${await loginAsTestAdmin(app)}` };
    const username = `new-${crypto.randomBytes(3).toString('hex')}`;
    const r = await request(app).post('/api/admin/users').set(A).send({ username, email: `${username}@example.org`, password: PASSWORD });
    expect(r.status).toBe(201);
    expect(r.body.data.emailVerified).toBe(false);
    expect(r.body.verification).toMatchObject({ delivery: 'simulated' });
    const list = await request(app).get('/api/admin/users').set(A);
    const row = list.body.data.find((x: { username: string }) => x.username === username);
    expect(row).toMatchObject({ emailVerified: false, lastCodeDelivery: { delivery: 'simulated' } });
    expect(JSON.stringify(list.body)).not.toMatch(/codeHash|passwordHash/);
    expect(JSON.stringify([r.body, list.body])).not.toContain(codeIn());
  });

  it('the configured administrator is the only automatic exception; other accounts are never auto-verified', () => {
    const admins = db.getUsers().filter((u) => u.role === 'admin');
    expect(admins.every((a) => a.emailVerified)).toBe(true);
    expect(newUser().emailVerified).toBe(false);
  });
});

describe('delivery providers', () => {
  it('a provider failure is recorded as failed, never as sent', async () => {
    const failing = new BrevoEmailProvider('k', 'from@example.org', 'CR', async () => ({ ok: false, status: 401, json: async () => ({ code: 'unauthorized' }) }));
    setEmailProvider(failing);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const u = newUser();
    const r = await signIn(u.username);
    expect(r.status).toBe(403);
    expect(r.body.delivery).toBe('failed');
    const rec = db.getEmailOtps().find((o) => o.userId === u.id)!;
    expect(rec).toMatchObject({ delivery: 'failed', deliveryProvider: 'brevo' });
    expect(rec.deliveryError).toContain('401');
  });

  it('a network error or timeout is also a failure', async () => {
    const p = new BrevoEmailProvider('k', 'f@example.org', 'CR', async () => {
      throw Object.assign(new Error('x'), { name: 'TimeoutError' });
    });
    expect(await p.send({ to: 'a@example.org', subject: 's', text: 't', html: 'h' })).toMatchObject({ status: 'failed', error: 'Provider timed out.' });
  });

  it('Brevo is called over HTTPS with the key in a header, and accepted messages count as sent', async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const p = new BrevoEmailProvider('secret-key', 'from@example.org', 'CarbonRoute', async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 201, json: async () => ({ messageId: 'm1' }) };
    });
    const r = await p.send({ to: 'a@example.org', subject: 'S', text: 'T', html: 'H' });
    expect(r).toEqual({ status: 'sent', provider: 'brevo', messageId: 'm1' });
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0].init.headers['api-key']).toBe('secret-key');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ sender: { email: 'from@example.org' }, to: [{ email: 'a@example.org' }] });
  });

  it('with no provider configured nothing is reported as sent, and the unusable code is closed', async () => {
    setEmailProvider(new NoEmailProvider());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const u = newUser();
    const r = await signIn(u.username);
    expect(r.body.delivery).toBe('not-configured');
    expect(r.body.detail).toMatch(/not configured/);
    expect(db.getEmailOtps().filter((o) => o.userId === u.id && !o.consumedAt)).toHaveLength(0);
  });

  it('the development console provider is refused in production; missing credentials mean no delivery', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(emailProviderFromEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'console' } as never).name).toBe('none');
    expect(emailProviderFromEnv({ NODE_ENV: 'development', EMAIL_PROVIDER: 'console' } as never).name).toBe('console');
    expect(emailProviderFromEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'brevo' } as never).name).toBe('none');
    const brevo = emailProviderFromEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', EMAIL_FROM: 'f@example.org' } as never);
    expect(brevo).toMatchObject({ name: 'brevo', delivers: true });
    expect(emailProviderFromEnv({} as never).name).toBe('none');
  });

  it('GET /api/auth/verification-config tells the client whether codes can be emailed', async () => {
    setEmailProvider(new NoEmailProvider());
    expect((await request(app).get('/api/auth/verification-config')).body.data).toEqual({ emailDelivery: 'not-configured', codeTtlMinutes: 5 });
    setEmailProvider(outbox);
    expect((await request(app).get('/api/auth/verification-config')).body.data.emailDelivery).toBe('development-console');
  });
});

describe('email validation', () => {
  it('syntax', () => {
    for (const ok of ['a@example.org', 'first.last+tag@sub.example.co.in', "o'brien@example.com"]) expect(emailSyntaxProblem(ok)).toBeNull();
    for (const bad of ['', 'a', 'a@', '@b.org', 'a@b', 'a@@b.org', 'a b@c.org', 'a..b@c.org', '.a@c.org', 'a@-b.org', 'a@b.c0m', `${'x'.repeat(65)}@b.org`]) {
      expect(emailSyntaxProblem(bad)).not.toBeNull();
    }
  });

  const resolver = (r: Partial<Record<keyof MailResolver, () => Promise<any>>>): MailResolver => {
    const nf = () => Promise.reject(Object.assign(new Error('nf'), { code: 'ENOTFOUND' }));
    return { resolveMx: r.resolveMx ?? nf, resolve4: r.resolve4 ?? nf, resolve6: r.resolve6 ?? nf } as MailResolver;
  };

  it('DNS: MX or address records accept; non-existent domains and null MX reject; inconclusive never rejects', async () => {
    expect((await checkMailDomain('a@x.org', resolver({ resolveMx: async () => [{ exchange: 'mx.x.org', priority: 10 }] }))).verdict).toBe('accepts-mail');
    expect((await checkMailDomain('a@x.org', resolver({ resolve4: async () => ['1.2.3.4'] }))).verdict).toBe('accepts-mail');
    expect((await checkMailDomain('a@x.org', resolver({}))).verdict).toBe('no-mail');
    expect((await checkMailDomain('a@x.org', resolver({ resolveMx: async () => [{ exchange: '.', priority: 0 }] }))).verdict).toBe('no-mail');
    const servfail = () => Promise.reject(Object.assign(new Error('x'), { code: 'ESERVFAIL' }));
    expect((await checkMailDomain('a@x.org', resolver({ resolveMx: servfail }))).verdict).toBe('inconclusive');
    const slow = () => new Promise<never>(() => {});
    expect((await checkMailDomain('a@x.org', resolver({ resolveMx: slow }), 20)).verdict).toBe('inconclusive');
  });
});

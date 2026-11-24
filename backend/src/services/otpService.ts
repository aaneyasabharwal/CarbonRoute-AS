/**
 * Email one-time codes (P22).
 *
 * - 6 digits from crypto.randomInt (uniform, cryptographically secure), generated on the backend.
 * - Bound to one account and one purpose; only an HMAC-SHA256 of (account, purpose, code) is stored,
 *   keyed by a secret derived from JWT_SECRET, so the database never holds a usable code.
 * - Valid for 5 minutes, single use, and a new code supersedes every earlier open code.
 * - At most 5 wrong entries per code; then the code is closed and a new one must be requested.
 * - Resend limits per account: 60 s between codes and at most 5 codes per rolling hour (stored with
 *   the codes, so a restart does not reset them when storage is durable). Per-address request limits
 *   are applied in the routes.
 * - Delivery is recorded honestly: `sent` only when the provider accepted the message.
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { db, EmailOtp, User } from '../models/db';
import { emailProvider } from './emailProvider';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_FAILED_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_MAX_PER_HOUR = 5;
const PURPOSE = 'verify-email' as const;

const otpKey = () => crypto.createHmac('sha256', config.jwtSecret).update('carbonroute-email-otp-v1').digest();

export function hashOtp(userId: string, code: string): string {
  return crypto.createHmac('sha256', otpKey()).update(`${userId}|${PURPOSE}|${code}`).digest('hex');
}

/** A uniformly random 6-digit code. */
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

const isOpen = (o: EmailOtp) => !o.consumedAt;
const forUser = (userId: string) => db.getEmailOtps().filter((o) => o.userId === userId && o.purpose === PURPOSE);

export type IssueResult =
  | { status: 'issued'; delivery: EmailOtp['delivery']; deliveryError?: string; expiresAt: string; retryAfterSeconds: number }
  | { status: 'rate-limited'; retryAfterSeconds: number; message: string }
  | { status: 'already-verified' };

/** Masks an address for display: "ab***@example.org". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

function message(user: User, code: string) {
  const minutes = OTP_TTL_MS / 60_000;
  const text =
    `Hello ${user.username},\n\nYour CarbonRoute verification code is ${code}.\n` +
    `It expires in ${minutes} minutes and can be used once.\n\n` +
    `If you did not expect this email, you can ignore it.`;
  const html =
    `<p>Hello ${escapeHtml(user.username)},</p><p>Your CarbonRoute verification code is ` +
    `<strong style="font-size:20px;letter-spacing:3px">${code}</strong>.</p>` +
    `<p>It expires in ${minutes} minutes and can be used once.</p><p>If you did not expect this email, you can ignore it.</p>`;
  return { to: user.email, subject: 'Your CarbonRoute verification code', text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/**
 * Issues a new code for an unverified account and emails it, subject to the resend limits.
 * Every earlier open code of the account is closed first.
 */
export async function issueVerificationCode(user: User, now = Date.now()): Promise<IssueResult> {
  if (user.emailVerified) return { status: 'already-verified' };
  const mine = forUser(user.id);
  // Attempts made while no email provider was configured never reached anyone and called no
  // provider, so they count towards neither the cooldown nor the hourly limit.
  const attempts = mine.filter((o) => o.delivery !== 'not-configured');
  const last = attempts.reduce<EmailOtp | null>((a, o) => (!a || o.createdAt > a.createdAt ? o : a), null);
  if (last) {
    const wait = Date.parse(last.createdAt) + OTP_RESEND_COOLDOWN_MS - now;
    if (wait > 0) {
      const s = Math.ceil(wait / 1000);
      return {
        status: 'rate-limited',
        retryAfterSeconds: s,
        message:
          last.delivery === 'failed'
            ? `The last attempt to send a code failed less than a minute ago. You can try again in ${s} seconds.`
            : `A code was sent less than a minute ago: check your inbox (and spam folder). You can request a new code in ${s} seconds.`,
      };
    }
  }
  // The hourly limit counts only codes that went out: a server-side delivery failure (provider
  // misconfigured or down) must not lock the user out for an hour. The 60 s cooldown above and the
  // per-IP limit still bound retries against a failing provider.
  const lastHour = attempts.filter((o) => o.delivery !== 'failed' && now - Date.parse(o.createdAt) < 3600_000).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (lastHour.length >= OTP_MAX_PER_HOUR) {
    const s = Math.ceil((Date.parse(lastHour[0].createdAt) + 3600_000 - now) / 1000);
    return { status: 'rate-limited', retryAfterSeconds: s, message: `Too many codes requested. Try again in ${Math.ceil(s / 60)} minutes.` };
  }

  const nowIso = new Date(now).toISOString();
  for (const o of mine) {
    if (isOpen(o)) Object.assign(o, { consumedAt: nowIso, closedReason: 'superseded' as const });
  }
  const code = generateOtp();
  const record: EmailOtp = {
    id: uuidv4(),
    userId: user.id,
    purpose: PURPOSE,
    codeHash: hashOtp(user.id, code),
    createdAt: nowIso,
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    failedAttempts: 0,
    delivery: 'pending',
  };
  db.getEmailOtps().push(record);
  db.saveEmailOtps(now);

  const result = await emailProvider().send(message(user, code));
  record.delivery = result.status;
  record.deliveryProvider = result.provider;
  if (result.status === 'failed' || result.status === 'not-configured') {
    record.deliveryError = result.error;
    // A code that could not be delivered is closed at once: nobody can have received it.
    if (result.status === 'not-configured') Object.assign(record, { consumedAt: nowIso, closedReason: 'superseded' as const });
    console.warn(`[email] verification code for user ${user.id} not delivered: ${result.error}`);
  }
  db.saveEmailOtps(now);
  return {
    status: 'issued',
    delivery: record.delivery,
    ...(record.deliveryError ? { deliveryError: record.deliveryError } : {}),
    expiresAt: record.expiresAt,
    retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
  };
}

export type VerifyResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'malformed' | 'no-code' | 'expired' | 'too-many-attempts'; message: string }
  | { ok: false; reason: 'incorrect'; message: string; attemptsLeft: number };

/** Checks a code for an account. On success the account becomes verified (method "otp"). */
export function verifyCode(user: User, input: unknown, now = Date.now()): VerifyResult {
  const code = typeof input === 'string' ? input.trim() : '';
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'malformed', message: 'Enter the 6-digit code from the email.' };
  const open = forUser(user.id).filter(isOpen).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!open) return { ok: false, reason: 'no-code', message: 'There is no active code. Request a new code.' };
  const nowIso = new Date(now).toISOString();
  if (Date.parse(open.expiresAt) <= now) {
    Object.assign(open, { consumedAt: nowIso, closedReason: 'superseded' as const });
    db.saveEmailOtps(now);
    return { ok: false, reason: 'expired', message: 'This code has expired. Request a new code.' };
  }
  const expected = Buffer.from(open.codeHash, 'hex');
  const actual = Buffer.from(hashOtp(user.id, code), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    open.failedAttempts += 1;
    if (open.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
      Object.assign(open, { consumedAt: nowIso, closedReason: 'too-many-attempts' as const });
      db.saveEmailOtps(now);
      return { ok: false, reason: 'too-many-attempts', message: 'Too many incorrect attempts. Request a new code.' };
    }
    db.saveEmailOtps(now);
    const attemptsLeft = OTP_MAX_FAILED_ATTEMPTS - open.failedAttempts;
    return { ok: false, reason: 'incorrect', message: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.`, attemptsLeft };
  }
  Object.assign(open, { consumedAt: nowIso, closedReason: 'used' as const });
  db.saveEmailOtps(now);
  const verified = db.markEmailVerified(user.id, 'otp', user.username)!;
  return { ok: true, user: verified };
}

/** Latest delivery state of an account's codes, for the admin account list (no codes, no hashes). */
export function lastCodeDelivery(userId: string): { delivery: EmailOtp['delivery']; at: string } | null {
  const last = forUser(userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return last ? { delivery: last.delivery, at: last.createdAt } : null;
}

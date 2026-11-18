import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db, UserRole } from '../models/db';
import { ConfigError } from '../config/secrets';
import { AuthRequest, checkVerificationTicket, issueAccessToken, issueVerificationTicket } from '../middleware/auth';
import { issueVerificationCode, lastCodeDelivery, maskEmail, verifyCode, IssueResult, OTP_TTL_MS } from '../services/otpService';
import { emailProvider } from '../services/emailProvider';
import { checkMailDomain, dnsCheckEnabled } from '../services/emailValidation';

/**
 * Compared against when the account does not exist, so a failed login costs the same bcrypt work
 * whether or not the username exists (P8: no username enumeration by response time). It is the
 * hash of a random value that is not stored anywhere; no password matches it.
 */
const DUMMY_HASH = bcrypt.hashSync(`no-such-user-${Math.random()}-${Date.now()}`, bcrypt.genSaltSync(10));

const publicUser = (u: { id: string; username: string; email: string; role: string; createdAt?: string; emailVerified?: boolean }) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  emailVerified: Boolean(u.emailVerified),
  ...(u.createdAt ? { createdAt: u.createdAt } : {}),
});

/** What the client is told about a code it asked for (never the code). */
function describeIssue(r: IssueResult) {
  if (r.status === 'already-verified') return { delivery: 'already-verified' as const };
  if (r.status === 'rate-limited') return { delivery: 'rate-limited' as const, retryAfterSeconds: r.retryAfterSeconds, detail: r.message };
  const detail =
    r.delivery === 'sent'
      ? `A 6-digit code was emailed. It expires in ${OTP_TTL_MS / 60_000} minutes.`
      : r.delivery === 'simulated'
        ? 'Development mode: no email was sent. The code was printed to the server console only.'
        : r.delivery === 'not-configured'
          ? 'No code could be sent: email delivery is not configured on this server. Ask an administrator to confirm your address.'
          : 'The email could not be sent. Try again later, or ask an administrator.';
  return { delivery: r.delivery, retryAfterSeconds: r.retryAfterSeconds, detail };
}

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide both username (or email) and password.',
    });
  }

  const user = db.getUserByUsername(username);
  // Always run one bcrypt comparison (same cost for unknown users and wrong passwords).
  const isPasswordValid = bcrypt.compareSync(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials.',
    });
  }

  // P22: a correct password on an unverified account does not sign in. Only now (the password was
  // right) is the verification state revealed, so this cannot be used to enumerate accounts.
  if (!user.emailVerified) {
    try {
      const issued = await issueVerificationCode(user);
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address to finish signing in.',
        verificationTicket: issueVerificationTicket(user),
        maskedEmail: maskEmail(user.email),
        ...describeIssue(issued),
      });
    } catch (err: any) {
      console.error('[auth] could not start email verification:', err?.message || err);
      return res.status(500).json({ success: false, message: 'Could not start email verification. Try again.' });
    }
  }

  const token = issueAccessToken(user);

  db.addAuditLog('USER_LOGIN', 'User', user.id, `User ${user.username} logged in`, user.username);

  return res.json({
    success: true,
    message: 'Login successful.',
    token,
    user: publicUser(user),
  });
};

export const getMe = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated.',
    });
  }

  return res.json({
    success: true,
    user: publicUser(req.user),
  });
};

export const logout = (req: AuthRequest, res: Response) => {
  if (req.user) {
    // Revoke this token so it cannot be reused after signing out (M1.2).
    const payload = req.tokenPayload;
    if (payload?.jti) db.revokeToken(payload.jti, req.user.id, (payload.exp ?? Math.floor(Date.now() / 1000) + 7 * 86400) * 1000);
    db.addAuditLog('USER_LOGOUT', 'User', req.user.id, `User ${req.user.username} logged out`, req.user.username);
  }
  return res.json({
    success: true,
    message: 'Logged out successfully.',
  });
};

/**
 * Changes the signed-in user's password (P8). Requires the current password. Every token issued
 * before the change stops working (tokensValidAfter), including the one used for this request; a
 * new token is returned so the caller stays signed in on this device only.
 */
export const changePassword = (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Provide currentPassword and newPassword.' });
  }
  const user = db.getUserById(req.user!.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ success: false, message: 'The current password is incorrect.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: 'The new password must differ from the current one.' });
  }
  try {
    const updated = db.setUserPassword(user.username, newPassword, user.username);
    return res.json({ success: true, message: 'Password changed. Other sessions have been signed out.', token: issueAccessToken(updated) });
  } catch (err) {
    if (err instanceof ConfigError) return res.status(400).json({ success: false, message: err.message });
    throw err;
  }
};

/** Admin only: list accounts (never password hashes). */
export const listUsers = (_req: AuthRequest, res: Response) => {
  return res.json({
    success: true,
    data: db.getUsers().map((u) => ({
      ...publicUser(u),
      ...(u.emailVerificationMethod ? { emailVerificationMethod: u.emailVerificationMethod } : {}),
      lastCodeDelivery: lastCodeDelivery(u.id),
    })),
  });
};

/**
 * Admin only (P8): create an account. There is deliberately no public self-registration: every
 * account can spend the shared Electricity Maps quota, so accounts are issued by an administrator.
 * The same validation as `npm run user:create` applies (username, email, role, password strength).
 */
export const createUserAccount = async (req: AuthRequest, res: Response) => {
  const { username, email, password, role } = req.body || {};
  if ([username, email, password].some((v) => typeof v !== 'string') || (role !== undefined && typeof role !== 'string')) {
    return res.status(400).json({ success: false, message: 'Provide username, email, password and optionally role as text.' });
  }
  try {
    // P22: reject domains that definitely cannot receive mail; inconclusive DNS never rejects.
    if (dnsCheckEnabled() && email.includes('@')) {
      const check = await checkMailDomain(email.trim());
      if (check.verdict === 'no-mail') return res.status(400).json({ success: false, message: check.reason });
    }
    const user = db.createUser({ username, email, password, role: (role || 'student') as UserRole }, req.user!.username);
    // The new account is unverified; send its first code now (its owner can also sign in later to get one).
    const issued = await issueVerificationCode(user);
    return res.status(201).json({ success: true, data: publicUser(user), verification: describeIssue(issued) });
  } catch (err) {
    if (err instanceof ConfigError) return res.status(400).json({ success: false, message: err.message });
    console.error('[auth] create account failed:', (err as Error)?.message);
    return res.status(500).json({ success: false, message: 'Could not create the account.' });
  }
};

/** P22: resend a code. Needs the ticket from a sign-in with the correct password. */
export const resendVerificationCode = async (req: Request, res: Response) => {
  const user = checkVerificationTicket(req.body?.verificationTicket);
  if (!user) return res.status(401).json({ success: false, code: 'INVALID_TICKET', message: 'This verification session has expired. Sign in again.' });
  if (user.emailVerified) return res.json({ success: true, alreadyVerified: true, message: 'This email address is already verified. Sign in.' });
  try {
    const issued = await issueVerificationCode(user);
    const info = describeIssue(issued);
    if (issued.status === 'rate-limited') {
      res.setHeader('Retry-After', String(issued.retryAfterSeconds));
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: issued.message, ...info });
    }
    return res.status(202).json({ success: true, maskedEmail: maskEmail(user.email), message: info.detail, ...info });
  } catch (err: any) {
    console.error('[auth] resend failed:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Could not send a new code. Try again.' });
  }
};

/** P22: confirm a code. On success the account is verified and signed in. */
export const confirmVerificationCode = (req: Request, res: Response) => {
  const user = checkVerificationTicket(req.body?.verificationTicket);
  if (!user) return res.status(401).json({ success: false, code: 'INVALID_TICKET', message: 'This verification session has expired. Sign in again.' });
  if (user.emailVerified) return res.json({ success: true, alreadyVerified: true, message: 'This email address is already verified. Sign in.' });
  const result = verifyCode(user, req.body?.code);
  if (!result.ok) {
    const status = result.reason === 'too-many-attempts' ? 429 : 400;
    return res.status(status).json({
      success: false,
      code: `OTP_${result.reason.toUpperCase().replace(/-/g, '_')}`,
      message: result.message,
      ...(result.reason === 'incorrect' ? { attemptsLeft: result.attemptsLeft } : {}),
    });
  }
  db.addAuditLog('USER_LOGIN', 'User', result.user.id, `User ${result.user.username} verified email and logged in`, result.user.username);
  return res.json({
    success: true,
    message: 'Email verified. You are signed in.',
    token: issueAccessToken(result.user),
    user: publicUser(result.user),
  });
};

/** Public: whether this server can email codes (no provider names or keys). */
export const verificationConfig = (_req: Request, res: Response) => {
  const p = emailProvider();
  res.json({
    success: true,
    data: {
      emailDelivery: p.delivers ? 'configured' : p.name === 'console' ? 'development-console' : 'not-configured',
      codeTtlMinutes: OTP_TTL_MS / 60_000,
    },
  });
};

/** Admin: send a new code to an unverified account (same limits as requests by the account itself). */
export const adminSendVerificationCode = async (req: AuthRequest, res: Response) => {
  const user = db.getUserById(String(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
  if (user.emailVerified) return res.status(409).json({ success: false, message: 'This account is already verified.' });
  try {
    const issued = await issueVerificationCode(user);
    const info = describeIssue(issued);
    if (issued.status === 'rate-limited') return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: issued.message, ...info });
    db.addAuditLog('EMAIL_CODE_SENT', 'User', user.id, `Verification code requested for ${user.username} (${info.delivery})`, req.user!.username);
    return res.json({ success: true, message: info.detail, ...info });
  } catch (err: any) {
    console.error('[auth] admin resend failed:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Could not send a code.' });
  }
};

/**
 * Admin exception (P22, documented): confirm an address manually, e.g. on a server without an email
 * provider. Requires an explicit confirmation flag and is recorded in the audit log.
 */
export const adminAttestEmail = (req: AuthRequest, res: Response) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ success: false, message: 'Send {"confirm": true} to confirm that you have checked this address yourself.' });
  }
  const user = db.getUserById(String(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
  if (user.emailVerified) return res.status(409).json({ success: false, message: 'This account is already verified.' });
  const updated = db.markEmailVerified(user.id, 'admin-attested', req.user!.username)!;
  return res.json({ success: true, message: `${updated.username} marked as verified by an administrator.`, data: publicUser(updated) });
};

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db, UserRole } from '../models/db';
import { ConfigError } from '../config/secrets';
import { AuthRequest, issueAccessToken } from '../middleware/auth';

/**
 * Compared against when the account does not exist, so a failed login costs the same bcrypt work
 * whether or not the username exists (P8: no username enumeration by response time). It is the
 * hash of a random value that is not stored anywhere; no password matches it.
 */
const DUMMY_HASH = bcrypt.hashSync(`no-such-user-${Math.random()}-${Date.now()}`, bcrypt.genSaltSync(10));

const publicUser = (u: { id: string; username: string; email: string; role: string; createdAt?: string }) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  ...(u.createdAt ? { createdAt: u.createdAt } : {}),
});

export const login = (req: Request, res: Response) => {
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
  return res.json({ success: true, data: db.getUsers().map(publicUser) });
};

/**
 * Admin only (P8): create an account. There is deliberately no public self-registration: every
 * account can spend the shared Electricity Maps quota, so accounts are issued by an administrator.
 * The same validation as `npm run user:create` applies (username, email, role, password strength).
 */
export const createUserAccount = (req: AuthRequest, res: Response) => {
  const { username, email, password, role } = req.body || {};
  if ([username, email, password].some((v) => typeof v !== 'string') || (role !== undefined && typeof role !== 'string')) {
    return res.status(400).json({ success: false, message: 'Provide username, email, password and optionally role as text.' });
  }
  try {
    const user = db.createUser({ username, email, password, role: (role || 'student') as UserRole }, req.user!.username);
    return res.status(201).json({ success: true, data: publicUser(user) });
  } catch (err) {
    if (err instanceof ConfigError) return res.status(400).json({ success: false, message: err.message });
    throw err;
  }
};

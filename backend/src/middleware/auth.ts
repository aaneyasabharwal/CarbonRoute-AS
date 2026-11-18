import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db, User } from '../models/db';

/** Claims CarbonRoute puts in its access tokens. */
export interface AccessTokenPayload {
  id: string;
  username: string;
  role: string;
  /** Unique token id, used to revoke a single token (logout). */
  jti: string;
  /** Issue time in milliseconds (iat is only whole seconds). */
  iatMs: number;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: User;
  tokenPayload?: AccessTokenPayload;
}

/** Only this algorithm is accepted, so a token cannot choose a weaker one. */
const JWT_ALGORITHM = 'HS256' as const;

/** Signs an access token for a user (M1.2: every token carries an id so it can be revoked). */
export function issueAccessToken(user: Pick<User, 'id' | 'username' | 'role'>): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, iatMs: Date.now() },
    config.jwtSecret,
    { algorithm: JWT_ALGORITHM, expiresIn: config.jwtExpiresIn as any, jwtid: crypto.randomUUID() }
  );
}

export type TokenCheck =
  | { ok: true; user: User; payload: AccessTokenPayload }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'revoked' | 'unknown-user' | 'unverified' };

/**
 * P22: a short-lived ticket that only allows verifying the email of the account whose password was
 * just entered. It has its own audience, so it is never accepted as an access token (and an access
 * token is never accepted as a ticket).
 */
const TICKET_AUDIENCE = 'carbonroute-email-verification';
export const VERIFICATION_TICKET_TTL = '15m';

export function issueVerificationTicket(user: Pick<User, 'id'>): string {
  return jwt.sign({ id: user.id }, config.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    audience: TICKET_AUDIENCE,
    expiresIn: VERIFICATION_TICKET_TTL,
    jwtid: crypto.randomUUID(),
  });
}

/** The account a verification ticket belongs to, or null when the ticket is not valid. */
export function checkVerificationTicket(ticket: unknown): User | null {
  if (typeof ticket !== 'string' || !ticket) return null;
  try {
    const p = jwt.verify(ticket, config.jwtSecret, { algorithms: [JWT_ALGORITHM], audience: TICKET_AUDIENCE }) as { id?: unknown };
    return typeof p.id === 'string' ? db.getUserById(p.id) ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a bearer token: signature (HS256 only), expiry, token id, revocation (logout),
 * the user's tokensValidAfter (password change) and that the user still exists.
 */
export function checkAccessToken(token: string | null | undefined): TokenCheck {
  if (!token) return { ok: false, reason: 'missing' };
  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] }) as AccessTokenPayload;
  } catch (err: any) {
    return { ok: false, reason: err?.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
  if (!payload || typeof payload.id !== 'string' || typeof payload.jti !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  // P22: tokens with an audience (verification tickets) are never access tokens.
  if ((payload as { aud?: unknown }).aud !== undefined) return { ok: false, reason: 'invalid' };
  if (db.isTokenRevoked(payload.jti)) return { ok: false, reason: 'revoked' };
  const user = db.getUserById(payload.id);
  if (!user) return { ok: false, reason: 'unknown-user' };
  if (user.tokensValidAfter) {
    const issuedMs = typeof payload.iatMs === 'number' ? payload.iatMs : (payload.iat ?? 0) * 1000;
    if (issuedMs < Date.parse(user.tokensValidAfter)) return { ok: false, reason: 'revoked' };
  }
  // P22: enforced on every request, not only at sign-in.
  if (!user.emailVerified) return { ok: false, reason: 'unverified' };
  return { ok: true, user, payload };
}

function bearerToken(req: Request): string | null {
  const header = req.headers['authorization'];
  return header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() || null : null;
}

const UNAUTHENTICATED_MESSAGES: Record<Exclude<TokenCheck, { ok: true }>['reason'], string> = {
  missing: 'Authentication required. Sign in and send the token as "Authorization: Bearer <token>".',
  invalid: 'Invalid authentication token. Please sign in again.',
  expired: 'Your session has expired. Please sign in again.',
  revoked: 'This session has ended (signed out or password changed). Please sign in again.',
  'unknown-user': 'Invalid authentication token. Please sign in again.',
  unverified: 'Verify your email address before using this account. Sign in again to receive a code.',
};

/**
 * Requires a valid access token. Every failure is 401 (the request is not authenticated);
 * 403 is reserved for authenticated users who lack a permission.
 */
export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const check = checkAccessToken(bearerToken(req));
  if (!check.ok && check.reason === 'unverified') {
    return res.status(403).json({ success: false, code: 'EMAIL_NOT_VERIFIED', message: UNAUTHENTICATED_MESSAGES.unverified });
  }
  if (!check.ok) {
    res.setHeader('WWW-Authenticate', `Bearer realm="carbonroute"${check.reason === 'missing' ? '' : ', error="invalid_token"'}`);
    return res.status(401).json({ success: false, code: 'UNAUTHENTICATED', message: UNAUTHENTICATED_MESSAGES[check.reason] });
  }
  req.user = check.user;
  req.tokenPayload = check.payload;
  next();
};

export const isAdmin = (user: User | undefined | null): boolean => user?.role === 'admin';

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  if (!isAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Administrator privileges are required.',
    });
  }

  next();
};

export const requireTeamMemberOrAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Authentication required to modify roadmap tasks.',
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'student') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Only authorized team members and administrators can modify roadmap tasks.',
    });
  }

  next();
};

/** Attaches the user when a valid token is sent; otherwise continues anonymously. */
export const optionalAuth = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const check = checkAccessToken(bearerToken(req));
  if (check.ok) {
    req.user = check.user;
    req.tokenPayload = check.payload;
  }
  next();
};

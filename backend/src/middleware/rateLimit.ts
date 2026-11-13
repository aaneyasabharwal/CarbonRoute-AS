/**
 * Fixed-window rate limiting (F11 / M1.8). In-memory, per process: enough for the single
 * backend instance this project runs; a shared store (e.g. Redis) is needed before running
 * several instances.
 *
 * Responses over the limit are 429 with Retry-After and RateLimit-* headers.
 */
import { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  /** Name used in messages and for resetting in tests. */
  name: string;
  windowMs: number;
  max: number;
  /** Bucket key for a request; null skips limiting for that request. */
  key: (req: Request) => string | null;
  message: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const limiters = new Map<string, Map<string, Bucket>>();

export function rateLimit(opts: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  limiters.set(opts.name, buckets);
  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.key(req);
    if (key === null) return next();
    const now = Date.now();
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(resetSeconds));
    if (bucket.count > opts.max) {
      res.setHeader('Retry-After', String(resetSeconds));
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: opts.message, retryAfterSeconds: resetSeconds });
    }
    next();
  };
}

/** Clears every limiter's counters (tests only). */
export function resetRateLimits(): void {
  for (const buckets of limiters.values()) buckets.clear();
}

const intFromEnv = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
};

const clientIp = (req: Request) => req.ip || req.socket?.remoteAddress || 'unknown';
const userKey = (req: Request) => ((req as any).user?.id ? `user:${(req as any).user.id}` : `ip:${clientIp(req)}`);

/** Limits read from the environment when the routes are built (defaults in brackets). */
export function rateLimitConfig() {
  return {
    loginPerAccount: intFromEnv('RATE_LIMIT_LOGIN_MAX', 10), // per IP + username per window
    loginPerIp: intFromEnv('RATE_LIMIT_LOGIN_IP_MAX', 50),
    loginWindowMs: intFromEnv('RATE_LIMIT_LOGIN_WINDOW_MIN', 15) * 60_000,
    jobWrites: intFromEnv('RATE_LIMIT_JOBS_MAX', 30), // per user per window
    jobWindowMs: intFromEnv('RATE_LIMIT_JOBS_WINDOW_MIN', 10) * 60_000,
    carbonLive: intFromEnv('RATE_LIMIT_CARBON_MAX', 60), // live provider requests per user per window
    carbonWindowMs: intFromEnv('RATE_LIMIT_CARBON_WINDOW_MIN', 60) * 60_000,
  };
}

export function buildRateLimiters() {
  const c = rateLimitConfig();
  const minutes = (ms: number) => Math.round(ms / 60_000);
  return {
    loginPerAccount: rateLimit({
      name: 'login-account',
      windowMs: c.loginWindowMs,
      max: c.loginPerAccount,
      key: (req) => `${clientIp(req)}|${String(req.body?.username ?? '').trim().toLowerCase()}`,
      message: `Too many sign-in attempts for this account. Try again in up to ${minutes(c.loginWindowMs)} minutes.`,
    }),
    loginPerIp: rateLimit({
      name: 'login-ip',
      windowMs: c.loginWindowMs,
      max: c.loginPerIp,
      key: (req) => clientIp(req),
      message: `Too many sign-in attempts from this address. Try again in up to ${minutes(c.loginWindowMs)} minutes.`,
    }),
    jobWrites: rateLimit({
      name: 'job-writes',
      windowMs: c.jobWindowMs,
      max: c.jobWrites,
      key: userKey,
      message: `Too many job submissions or actions. The limit is ${c.jobWrites} per ${minutes(c.jobWindowMs)} minutes.`,
    }),
    carbonLive: rateLimit({
      name: 'carbon-live',
      windowMs: c.carbonWindowMs,
      max: c.carbonLive,
      key: userKey,
      message: `Too many live carbon-data requests. The limit is ${c.carbonLive} per ${minutes(c.carbonWindowMs)} minutes.`,
    }),
  };
}

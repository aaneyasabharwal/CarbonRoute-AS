/**
 * Secret handling (remediation task M1.1, audit C4).
 *
 * No secret has a default value in the code. In production, a missing, short or known-leaked
 * JWT secret stops the server from starting. In development and tests a random secret is
 * generated for the process (sessions do not survive a restart) and a warning is logged.
 *
 * Known-leaked values (the defaults that were committed to this repository, and the
 * placeholders shown in the docs) are recognised by their SHA-256 fingerprint only, so the
 * values themselves are not stored in the code.
 */
import crypto from 'crypto';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** SHA-256 of values that were published in this repository's history or docs. */
const LEAKED_SHA256 = new Set([
  'b4e3de0405b5d1c7369c1192b2e5eced2bdfbceb90e887bdb907f68eb9a91075', // former JWT default (config, .env.example)
  'bc390dab9389e3973bca584a40e0d4248775369c6222b8e23540bc2b50db468d', // former docker-compose JWT secret
  '2f7abba858c08f93f12989e008b90d82204c8e6d52e3a11205fa72d5498a9e88', // former default admin password
  '40413ddaaa626fe75473d266ecea5961623de07bebec3f1ed9e5154a59a5b338', // DEPLOYMENT.md JWT placeholder
  'c15fa2886840abb034dfaef8f1945537f2cfde97fdb0e4f4e93104bbf180580a', // DEPLOYMENT.md password placeholder
]);

export const MIN_JWT_SECRET_LENGTH = 32;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export function isKnownLeakedValue(value: string): boolean {
  return LEAKED_SHA256.has(crypto.createHash('sha256').update(value).digest('hex'));
}

export const GENERATE_SECRET_HINT = `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`;

/** Returns why a JWT secret is unacceptable, or null when it is acceptable. */
export function jwtSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'JWT_SECRET is not set.';
  if (secret.length < MIN_JWT_SECRET_LENGTH) return `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters.`;
  if (isKnownLeakedValue(secret)) return 'JWT_SECRET is a value that was published in this repository and must not be used.';
  return null;
}

/** Returns why an admin password is unacceptable, or null when it is acceptable. */
export function adminPasswordProblem(password: string | undefined): string | null {
  if (!password) return 'ADMIN_PASSWORD is not set.';
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) return `ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`;
  if (isKnownLeakedValue(password)) return 'ADMIN_PASSWORD is a value that was published in this repository and must not be used.';
  return null;
}

export interface ResolvedJwtSecret {
  secret: string;
  source: 'environment' | 'generated-for-this-process';
}

/**
 * Production: JWT_SECRET must be set and acceptable, otherwise a ConfigError is thrown.
 * Other environments: an unacceptable or missing value is replaced by a random secret for the
 * lifetime of the process, with a warning. A value that is set but weak is never used.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv, warn: (msg: string) => void = console.warn): ResolvedJwtSecret {
  const value = env.JWT_SECRET?.trim();
  const problem = jwtSecretProblem(value);
  const isProduction = (env.NODE_ENV || 'development') === 'production';
  if (!problem) return { secret: value as string, source: 'environment' };
  if (isProduction) {
    throw new ConfigError(`${problem} Refusing to start in production. Generate one with: ${GENERATE_SECRET_HINT}`);
  }
  warn(`[config] ${problem} Using a random JWT secret for this process only; sessions end when the server restarts. Set JWT_SECRET (see .env.example).`);
  return { secret: crypto.randomBytes(48).toString('base64url'), source: 'generated-for-this-process' };
}

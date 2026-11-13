/**
 * M1.1: no hardcoded credentials (audit C4).
 *
 * Replaces test/legacy/defaultAdminSeed.legacy.test.ts, which recorded the old behaviour of
 * seeding the admin with a hardcoded password. Passwords in these tests are generated
 * randomly at run time; no real or formerly published secret appears in this file.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  adminPasswordProblem,
  ConfigError,
  isKnownLeakedValue,
  jwtSecretProblem,
  resolveJwtSecret,
} from '../../src/config/secrets';
import { runSetAdminPassword } from '../../src/scripts/setAdminPassword';

const randomSecret = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

/** Values committed before M1.1, read from git history (commit 7482ee4). Null if unavailable. */
function formerValues(): { jwtDefault: string; dockerJwt: string; adminPassword: string } | null {
  try {
    const show = (p: string) =>
      require('child_process').execSync(`git show 7482ee4:${p}`, { cwd: path.join(__dirname, '..', '..', '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const envExample = show('.env.example');
    const compose = show('docker/docker-compose.yml');
    return {
      jwtDefault: envExample.match(/^JWT_SECRET=(.*)$/m)![1].trim(),
      adminPassword: envExample.match(/^ADMIN_PASSWORD=(.*)$/m)![1].trim(),
      dockerJwt: compose.match(/JWT_SECRET=(\S+)/)![1],
    };
  } catch {
    return null;
  }
}

/** Keys this file changes; restored after every test. */
const KEYS = ['NODE_ENV', 'JWT_SECRET', 'ADMIN_PASSWORD', 'ADMIN_USERNAME', 'ADMIN_EMAIL', 'CARBONROUTE_DB_FILE'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Loads a fresh copy of the database module against an empty temporary file. */
async function freshDb(env: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-test-seed-')), 'db.json');
  process.env.CARBONROUTE_DB_FILE = file;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const mod = await import('../../src/models/db');
  return { db: mod.db, file };
}

describe('JWT secret', () => {
  it('production refuses a missing or short secret', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'too-short' })).toThrow(/at least 32 characters/);
  });

  // The formerly committed values are read from git history at test time (they are not copied
  // into this file). CI checkouts are shallow, so this test is skipped there when the commit
  // is not available; it runs in any full clone.
  const former = formerValues();
  it.skipIf(!former)('production and seeding refuse every formerly committed secret and password', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: former!.jwtDefault })).toThrow(/published in this repository/);
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: former!.dockerJwt })).toThrow(/published in this repository/);
    expect(adminPasswordProblem(former!.adminPassword)).toMatch(/published in this repository/);
  });

  it('production accepts a strong secret from the environment', () => {
    const secret = randomSecret();
    expect(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: secret })).toEqual({ secret, source: 'environment' });
  });

  it('development generates a random per-process secret with a warning, and never uses a weak value', () => {
    const warn = vi.fn();
    const a = resolveJwtSecret({ NODE_ENV: 'development' }, warn);
    const b = resolveJwtSecret({ NODE_ENV: 'development', JWT_SECRET: 'weak' }, warn);
    expect(a.source).toBe('generated-for-this-process');
    expect(a.secret.length).toBeGreaterThanOrEqual(48);
    expect(b.secret).not.toBe('weak');
    expect(a.secret).not.toBe(b.secret);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/random JWT secret for this process/);
  });

  it('the running test process uses a generated secret, not a committed default', async () => {
    const { config } = await import('../../src/config');
    expect(config.jwtSecretSource).toBe('generated-for-this-process');
    expect(isKnownLeakedValue(config.jwtSecret)).toBe(false);
  });

  it('jwtSecretProblem explains each failure', () => {
    expect(jwtSecretProblem(undefined)).toMatch(/not set/);
    expect(jwtSecretProblem('x'.repeat(31))).toMatch(/at least 32/);
    expect(jwtSecretProblem(randomSecret())).toBeNull();
  });
});

describe('admin password checks', () => {
  it('requires a set, long, unpublished password', () => {
    expect(adminPasswordProblem(undefined)).toMatch(/not set/);
    expect(adminPasswordProblem('short')).toMatch(/at least 12/);
    expect(adminPasswordProblem(randomSecret(12))).toBeNull();
  });

  it('recognises the formerly published values only by fingerprint', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'config', 'secrets.ts'), 'utf8');
    const fingerprints = src.match(/'[0-9a-f]{64}'/g) || [];
    expect(fingerprints).toHaveLength(5);
    expect(isKnownLeakedValue(randomSecret())).toBe(false);
  });
});

describe('initial admin seeding', () => {
  it('creates the admin from ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD on an empty database', async () => {
    const password = randomSecret(16);
    const { db, file } = await freshDb({ NODE_ENV: 'test', ADMIN_PASSWORD: password, ADMIN_USERNAME: 'ops-admin', ADMIN_EMAIL: 'ops@example.invalid' });
    const users = db.getUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ username: 'ops-admin', email: 'ops@example.invalid', role: 'admin' });
    expect(bcrypt.compareSync(password, users[0].passwordHash)).toBe(true);
    expect(users[0].passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(fs.readFileSync(file, 'utf8')).not.toContain(password);
  });

  it('without ADMIN_PASSWORD outside production: no admin is created and a warning explains why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = await freshDb({ NODE_ENV: 'test', ADMIN_PASSWORD: undefined });
    expect(db.getUsers()).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0])).join(' ')).toMatch(/No admin account was created/);
  });

  it('with a weak ADMIN_PASSWORD outside production: no admin is created', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = await freshDb({ NODE_ENV: 'test', ADMIN_PASSWORD: 'short' });
    expect(db.getUsers()).toEqual([]);
  });

  it('in production without ADMIN_PASSWORD the server refuses to start', async () => {
    await expect(freshDb({ NODE_ENV: 'production', JWT_SECRET: randomSecret(), ADMIN_PASSWORD: undefined })).rejects.toThrow(
      /required to create the initial admin account/
    );
  });

  it('in production without JWT_SECRET the server refuses to start', async () => {
    await expect(freshDb({ NODE_ENV: 'production', JWT_SECRET: undefined, ADMIN_PASSWORD: randomSecret(16) })).rejects.toThrow(/JWT_SECRET is not set/);
  });

  it('an existing user table is never overwritten by seeding', async () => {
    const first = randomSecret(16);
    const { file } = await freshDb({ NODE_ENV: 'test', ADMIN_PASSWORD: first });
    process.env.ADMIN_PASSWORD = randomSecret(16);
    vi.resetModules();
    const { db } = await import('../../src/models/db');
    expect(db.getUsers()).toHaveLength(1);
    expect(bcrypt.compareSync(first, db.getUsers()[0].passwordHash)).toBe(true);
    expect(process.env.CARBONROUTE_DB_FILE).toBe(file);
  });
});

describe('password rotation (npm run admin:set-password)', () => {
  it('replaces the password, logs no secret and records an audit entry', async () => {
    const original = randomSecret(16);
    const { db } = await freshDb({ NODE_ENV: 'test', ADMIN_PASSWORD: original });
    const next = randomSecret(16);
    const log = vi.fn();
    expect(runSetAdminPassword({ NEW_ADMIN_PASSWORD: next }, db, log)).toBe(0);
    const admin = db.getUserByUsername('admin')!;
    expect(bcrypt.compareSync(next, admin.passwordHash)).toBe(true);
    expect(bcrypt.compareSync(original, admin.passwordHash)).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain(next);
    expect(db.getAuditLogs()[0]).toMatchObject({ action: 'PASSWORD_CHANGED' });
  });

  it('refuses a missing, weak or unknown-user change and leaves the password unchanged', async () => {
    const original = randomSecret(16);
    const { db } = await freshDb({ NODE_ENV: 'test', ADMIN_PASSWORD: original });
    const log = vi.fn();
    expect(runSetAdminPassword({}, db, log)).toBe(2);
    expect(runSetAdminPassword({ NEW_ADMIN_PASSWORD: 'short' }, db, log)).toBe(1);
    expect(runSetAdminPassword({ NEW_ADMIN_PASSWORD: randomSecret(16), ADMIN_USERNAME: 'nobody' }, db, log)).toBe(1);
    expect(bcrypt.compareSync(original, db.getUserByUsername('admin')!.passwordHash)).toBe(true);
  });
});

describe('repository contains no committed credentials', () => {
  it('none of the formerly published values appear in tracked text files', () => {
    const repo = path.join(__dirname, '..', '..', '..');
    const tracked = require('child_process')
      .execSync('git ls-files', { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .filter((f: string) => f && !/\.(pdf|png|jpe?g|exe|ico|woff2?)$/i.test(f) && !f.endsWith('package-lock.json'));
    const offenders: string[] = [];
    for (const f of tracked) {
      const full = path.join(repo, f);
      if (!fs.existsSync(full) || fs.statSync(full).size > 2_000_000) continue;
      const text = fs.readFileSync(full, 'utf8');
      // Check every token that looks like a secret/password assignment value.
      for (const m of text.matchAll(/(?:JWT_SECRET|ADMIN_PASSWORD|password|jwtSecret)["']?\s*[:=]\s*["']?([^\s"',`)]{8,})/gi)) {
        if (isKnownLeakedValue(m[1])) offenders.push(`${f}: ${m[0].slice(0, 20)}…`);
      }
      for (const tok of text.match(/[A-Za-z0-9_!@#$%^&*.\-]{20,64}/g) || []) {
        if (isKnownLeakedValue(tok)) offenders.push(`${f}: token`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

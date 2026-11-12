/**
 * Proves the test suite is isolated from real data and from other test files.
 *
 * The app is imported dynamically AFTER the real data locations have been
 * fingerprinted, so any write to them during this file would be detected.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestEnv, ISOLATED_ENV_VARS, TEMP_DIR_PREFIX } from '../support/testEnv';
import { loginAsTestAdmin, testAdminCredentials } from '../support/auth';

const repoRoot = path.resolve(__dirname, '../../..');
// The file the backend uses when CARBONROUTE_DB_FILE is not set (db.ts, unchanged path).
const realDbFile = path.join(repoRoot, 'database', 'carbonroute.db.json');
// Real upload folders: the backend default (config.localStorageDir) and the Docker volume.
const realUploadDirs = [path.join(repoRoot, 'backend', 'uploads'), path.join(repoRoot, 'storage', 'uploads')];

/** Map of file path -> sha256 + mtime for a file or every file under a folder. */
function fingerprint(target: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    out[target] = `${crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')}@${stat.mtimeMs}`;
    return out;
  }
  for (const entry of fs.readdirSync(target)) Object.assign(out, fingerprint(path.join(target, entry)));
  return out;
}

const realDataBefore = {
  dbExists: fs.existsSync(realDbFile),
  db: fingerprint(realDbFile),
  uploads: Object.assign({}, ...realUploadDirs.map(fingerprint)),
};

let app: Express;

beforeAll(async () => {
  app = (await import('../../src/app')).default;
});

describe('temporary database', () => {
  it('points the database and uploads at a fresh folder under the OS temp directory', () => {
    const dbFile = process.env.CARBONROUTE_DB_FILE!;
    const uploads = process.env.LOCAL_STORAGE_DIR!;
    const tmp = fs.realpathSync(os.tmpdir());
    for (const p of [dbFile, uploads]) {
      expect(fs.realpathSync(path.dirname(p)).startsWith(tmp)).toBe(true);
      expect(p).toContain(TEMP_DIR_PREFIX);
    }
    expect(path.resolve(dbFile)).not.toBe(path.resolve(realDbFile));
  });

  it('writes made by the app land in the temporary database file', async () => {
    await loginAsTestAdmin(app); // the login handler appends an audit log and saves the database
    const saved = JSON.parse(fs.readFileSync(process.env.CARBONROUTE_DB_FILE!, 'utf8'));
    const actions = saved.activityLogs.map((l: { action: string; performedBy?: string }) => l.action);
    expect(actions).toContain('USER_LOGIN');
    expect(saved.users.map((u: { username: string }) => u.username)).toEqual([testAdminCredentials().username]);
  });

  it('uploaded files land in the temporary uploads folder', async () => {
    const token = await loginAsTestAdmin(app);
    const res = await request(app)
      .post('/api/resources/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('isolation check'), 'isolation.txt')
      .field('title', 'Isolation check')
      .field('category', 'documentation');
    expect(res.status).toBe(201);
    expect(fs.existsSync(path.join(process.env.LOCAL_STORAGE_DIR!, 'resources', res.body.data.fileName))).toBe(true);
  });

  it('starts from a fresh database with no records created by other test files', async () => {
    // portal.test.ts creates version "v9-test" and the legacy suite tries "v2" uploads;
    // none of that may be visible here, whatever order the files run in.
    const versions = (await request(app).get('/api/presentations/versions')).body.data.map(
      (p: { versionTag: string }) => p.versionTag
    );
    expect(versions).not.toContain('v9-test');
    expect(versions).not.toContain('edit-test');
  });
});

describe('real data is not modified', () => {
  it('the original database file is unchanged (or still absent)', () => {
    expect(fs.existsSync(realDbFile)).toBe(realDataBefore.dbExists);
    expect(fingerprint(realDbFile)).toEqual(realDataBefore.db);
  });

  it('the real upload folders are unchanged', () => {
    expect(Object.assign({}, ...realUploadDirs.map(fingerprint))).toEqual(realDataBefore.uploads);
  });
});

describe('environment variables', () => {
  it('a real Electricity Maps key never reaches the tests', () => {
    expect(process.env.ELECTRICITY_MAPS_API_KEY).toBe('');
  });

  it('restore() puts every variable back exactly and deletes the temporary folder', () => {
    const outer = new Map(ISOLATED_ENV_VARS.map((n) => [n, process.env[n]]));
    // Simulate a developer shell: one variable set to a sentinel, one absent.
    process.env.LOCAL_STORAGE_DIR = 'sentinel-value';
    delete process.env.CARBONROUTE_TEST_ADMIN_USERNAME;

    const env = createTestEnv();
    expect(process.env.LOCAL_STORAGE_DIR).toBe(env.uploadsDir);
    expect(process.env.CARBONROUTE_TEST_ADMIN_USERNAME).toBe(env.admin.username);
    expect(fs.existsSync(env.root)).toBe(true);

    env.restore();
    expect(process.env.LOCAL_STORAGE_DIR).toBe('sentinel-value');
    expect('CARBONROUTE_TEST_ADMIN_USERNAME' in process.env).toBe(false);
    expect(fs.existsSync(env.root)).toBe(false);

    // Put this file's own environment back.
    for (const [n, v] of outer) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  });

  it('each environment gets its own folder and its own random admin password', () => {
    const a = createTestEnv();
    const b = createTestEnv();
    try {
      expect(a.root).not.toBe(b.root);
      expect(a.admin.password).not.toBe(b.admin.password);
      expect(a.admin.password.length).toBeGreaterThanOrEqual(20);
    } finally {
      b.restore();
      a.restore();
    }
    // a.restore() ran last, so this file's own values are back.
    expect(process.env.CARBONROUTE_DB_FILE).toContain(TEMP_DIR_PREFIX);
    expect(fs.existsSync(process.env.CARBONROUTE_DB_FILE!)).toBe(true);
  });
});

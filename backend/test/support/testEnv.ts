/**
 * Isolated test environment.
 *
 * createTestEnv():
 *  - creates a fresh temporary directory for the JSON database and uploads;
 *  - pre-creates the temporary database with a test-only admin account whose
 *    password is generated randomly for this run (it never appears in source code,
 *    so tests do not copy the hardcoded seeded password; that is removed in M1.1);
 *  - sets the environment variables the backend reads, after saving their previous values.
 *
 * restore() puts every variable back exactly as it was (deleting ones that did not
 * exist before) and removes the temporary directory.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

export const ISOLATED_ENV_VARS = [
  'NODE_ENV',
  'CARBONROUTE_DB_FILE',
  'LOCAL_STORAGE_DIR',
  'STORAGE_TYPE',
  'ELECTRICITY_MAPS_API_KEY',
  'CARBONROUTE_TEST_ADMIN_USERNAME',
  'CARBONROUTE_TEST_ADMIN_PASSWORD',
] as const;

export const TEMP_DIR_PREFIX = 'carbonroute-test-';
export const TEST_ADMIN_USERNAME = 'test-admin';

export interface TestEnv {
  root: string;
  dbFile: string;
  uploadsDir: string;
  admin: { username: string; password: string };
  restore(): void;
}

export function createTestEnv(): TestEnv {
  const saved = new Map<string, string | undefined>(
    ISOLATED_ENV_VARS.map((name) => [name, process.env[name]])
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
  const dbFile = path.join(root, 'database', 'carbonroute.db.json');
  const uploadsDir = path.join(root, 'uploads');
  const admin = { username: TEST_ADMIN_USERNAME, password: crypto.randomBytes(18).toString('base64url') };

  // Pre-create the database with only the test admin. The backend still seeds every
  // other collection (team, presentations, roadmap, logs) because those are empty;
  // it skips its default admin because a user already exists.
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.writeFileSync(
    dbFile,
    JSON.stringify({
      users: [
        {
          id: crypto.randomUUID(),
          username: admin.username,
          email: 'test-admin@example.invalid',
          passwordHash: bcrypt.hashSync(admin.password, 4),
          role: 'admin',
          createdAt: new Date().toISOString(),
        },
      ],
    }),
    'utf8'
  );

  process.env.NODE_ENV = 'test';
  process.env.CARBONROUTE_DB_FILE = dbFile;
  process.env.LOCAL_STORAGE_DIR = uploadsDir;
  process.env.STORAGE_TYPE = 'local';
  // dotenv never overrides variables that already exist, so an empty value
  // guarantees no real key from a local .env file reaches the tests.
  process.env.ELECTRICITY_MAPS_API_KEY = '';
  process.env.CARBONROUTE_TEST_ADMIN_USERNAME = admin.username;
  process.env.CARBONROUTE_TEST_ADMIN_PASSWORD = admin.password;

  return {
    root,
    dbFile,
    uploadsDir,
    admin,
    restore() {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}

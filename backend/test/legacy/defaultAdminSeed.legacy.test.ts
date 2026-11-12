/**
 * [legacy] Default admin seeding (src/models/db.ts, seedDefaultsIfEmpty).
 *
 * When the database has no users, the backend creates a default admin account.
 * Its password is currently hardcoded in db.ts (audit C4); task M1.1 changes this
 * so the seed uses configuration instead. That PR updates this test.
 *
 * This test deliberately does NOT contain, log or assert the default password.
 * It only checks the account record and that the stored value is a bcrypt hash.
 *
 * It uses its own empty temporary database, separate from the per-file
 * test-admin fixture database created by test/setup.ts, and checks that the
 * fixture database is left untouched.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { User } from '../../src/models/db';

const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('[legacy] default admin seeding on an empty database', () => {
  const fixtureDbFile = process.env.CARBONROUTE_DB_FILE!;
  const fixtureDbHashBefore = sha256(fixtureDbFile);
  const seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-test-seed-'));
  const seedDbFile = path.join(seedRoot, 'database', 'carbonroute.db.json');
  let users: User[];

  beforeAll(async () => {
    expect(fs.existsSync(seedDbFile)).toBe(false);
    // The db module creates its singleton on first import, reading CARBONROUTE_DB_FILE.
    // Nothing in this file has imported it yet, so pointing the variable at an empty
    // location makes this import run the default seeding path.
    process.env.CARBONROUTE_DB_FILE = seedDbFile;
    try {
      const { db } = await import('../../src/models/db');
      users = db.getUsers();
    } finally {
      process.env.CARBONROUTE_DB_FILE = fixtureDbFile;
    }
  });

  afterAll(() => {
    fs.rmSync(seedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('creates exactly one admin account with the expected identity and role', () => {
    expect(users).toHaveLength(1);
    const [admin] = users;
    expect(admin).toMatchObject({ username: 'admin', email: 'admin@carbonroute.org', role: 'admin' });
    expect(admin.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(admin.createdAt))).toBe(false);
  });

  it('stores only a bcrypt hash (cost 10), never a plaintext password field', () => {
    const [admin] = users;
    expect(admin.passwordHash).toMatch(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/);
    expect(Object.keys(admin).sort()).toEqual(['createdAt', 'email', 'id', 'passwordHash', 'role', 'username']);
  });

  it('persists the seeded account to its own temporary database file', () => {
    const saved = JSON.parse(fs.readFileSync(seedDbFile, 'utf8'));
    expect(saved.users).toHaveLength(1);
    expect(saved.users[0].id).toBe(users[0].id);
    expect(saved.users[0].passwordHash).toBe(users[0].passwordHash);
  });

  it('leaves the test-admin fixture database and its environment variable untouched', () => {
    expect(process.env.CARBONROUTE_DB_FILE).toBe(fixtureDbFile);
    expect(sha256(fixtureDbFile)).toBe(fixtureDbHashBefore);
    const fixture = JSON.parse(fs.readFileSync(fixtureDbFile, 'utf8'));
    expect(fixture.users.map((u: User) => u.username)).toEqual([process.env.CARBONROUTE_TEST_ADMIN_USERNAME]);
  });
});

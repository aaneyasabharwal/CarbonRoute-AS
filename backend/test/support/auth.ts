/**
 * Test authentication fixture. Uses the per-run admin account created by
 * createTestEnv() (see testEnv.ts), never the hardcoded seeded password.
 */
import crypto from 'crypto';
import request from 'supertest';
import type { Express } from 'express';
import { db, type User, type UserRole } from '../../src/models/db';

export function testAdminCredentials(): { username: string; password: string } {
  const username = process.env.CARBONROUTE_TEST_ADMIN_USERNAME;
  const password = process.env.CARBONROUTE_TEST_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Test admin credentials are not set: is test/setup.ts configured in vitest.config.ts?');
  }
  return { username, password };
}

export async function loginAsTestAdmin(app: Express): Promise<string> {
  const res = await request(app).post('/api/auth/login').send(testAdminCredentials());
  if (res.status !== 200 || !res.body.token) {
    throw new Error(`Test admin login failed with HTTP ${res.status}`);
  }
  return res.body.token as string;
}

/**
 * Creates a user with a random name and password in this test file's temporary database
 * and signs it in (M1.2). Returns the token and an Authorization header for supertest.
 */
export async function createAndLoginUser(
  app: Express,
  role: UserRole = 'student'
): Promise<{ user: User; token: string; auth: { Authorization: string } }> {
  const username = `user-${crypto.randomBytes(5).toString('hex')}`;
  const password = crypto.randomBytes(18).toString('base64url');
  const user = db.createUser({ username, email: `${username}@example.invalid`, password, role });
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200 || !res.body.token) throw new Error(`Test user login failed with HTTP ${res.status}`);
  return { user, token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` } };
}

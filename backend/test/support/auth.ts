/**
 * Test authentication fixture. Uses the per-run admin account created by
 * createTestEnv() (see testEnv.ts), never the hardcoded seeded password.
 */
import request from 'supertest';
import type { Express } from 'express';

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

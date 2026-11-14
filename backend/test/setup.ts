/**
 * Runs before every test file (before the file's own imports are evaluated).
 * Gives each test file its own temporary database, uploads folder and test admin,
 * and restores the environment and deletes the temporary folder afterwards.
 * See test/support/testEnv.ts.
 */
import { afterAll } from 'vitest';
import { createTestEnv } from './support/testEnv';

const testEnv = createTestEnv();

afterAll(() => {
  testEnv.restore();
});

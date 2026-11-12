import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Each test file runs in its own module scope, so in-memory stores and the
    // JSON database singleton are re-created per file.
    isolate: true,
    testTimeout: 15000,
  },
});

import { defineConfig } from 'vitest/config';

const testTimeout = (Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] ?? '1') || 1) * 500;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout,
    hookTimeout: testTimeout,
    typecheck: {
      include: ['test/**/*.test-d.ts'],
    },
  },
});

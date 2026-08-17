import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup-temporal.ts'],
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
  },
});

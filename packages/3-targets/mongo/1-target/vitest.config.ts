import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup-temporal.ts'],
    testTimeout: timeouts.spinUpMongoMemoryServer,
    hookTimeout: timeouts.spinUpMongoMemoryServer,
    fileParallelism: false,
    sequence: { groupOrder: 4 },
  },
});

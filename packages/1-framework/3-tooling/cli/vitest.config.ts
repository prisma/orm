import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Note: do not change to 'threads', it will cause the failure
    // `TypeError: process.chdir() is not supported in workers`.
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    fileParallelism: false,
    sequence: { groupOrder: 1 },
    testTimeout: timeouts.vitestPackageDefault,
    hookTimeout: timeouts.vitestPackageDefault,
    setupFiles: ['./test/setup.ts'],
    env: {
      CI: 'true',
      NO_COLOR: '1',
    },
  },
});

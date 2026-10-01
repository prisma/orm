import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    maxWorkers: 1,
    isolate: false,
    testTimeout: timeouts.vitestPackageDefault,
    hookTimeout: timeouts.vitestPackageDefault,
  },
});

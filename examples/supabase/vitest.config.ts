import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: timeouts.vitestPackageDefault,
    hookTimeout: timeouts.vitestPackageDefault,
  },
});

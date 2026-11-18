import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

// Types-only package: SQL Schema IR types for schema introspection and verification
// No test files exist, but coverage config is included for consistency with other packages
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: timeouts.vitestPackageDefault,
    hookTimeout: timeouts.vitestPackageDefault,
  },
});

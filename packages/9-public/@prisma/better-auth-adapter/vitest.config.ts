import { defineConfig } from 'vitest/config';
import { timeouts } from './test/timeouts';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: timeouts.test,
    hookTimeout: timeouts.hook,
  },
});

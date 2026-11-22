import { defineConfig } from 'vitest/config';
import { cliTimeoutMs } from './test/timeouts';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: cliTimeoutMs,
    hookTimeout: cliTimeoutMs,
  },
});

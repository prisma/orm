import { defineConfig } from 'vitest/config';
import { sqliteCliTimeoutMs } from './test/timeouts';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: sqliteCliTimeoutMs,
    hookTimeout: sqliteCliTimeoutMs,
  },
});

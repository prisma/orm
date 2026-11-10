import { defineConfig } from 'vitest/config';
import { mysqlCliTimeoutMs } from './test/timeouts';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: mysqlCliTimeoutMs,
    hookTimeout: mysqlCliTimeoutMs,
  },
});

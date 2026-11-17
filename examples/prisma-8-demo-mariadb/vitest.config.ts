import { defineConfig } from 'vitest/config';
import { mariadbCliTimeoutMs } from './test/timeouts';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: mariadbCliTimeoutMs,
    hookTimeout: mariadbCliTimeoutMs,
  },
});

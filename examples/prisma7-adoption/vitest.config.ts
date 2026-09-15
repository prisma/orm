import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable V8 PKU JIT write-protection in the test worker forks: PGlite
    // (WASM) teardown still intermittently aborts on Linux otherwise. No-op on macOS.
    execArgv: ['--no-memory-protection-keys'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    testTimeout: timeouts.databaseOperation,
    hookTimeout: timeouts.databaseOperation,
  },
});

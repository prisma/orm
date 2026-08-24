import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup-temporal.ts'],
    // Disable V8 PKU JIT write-protection in the test worker forks: PGlite
    // (WASM) teardown still intermittently aborts on Linux with
    // jit_page_->allocations_.erase even on @prisma/dev 0.24.12. No-op on macOS.
    execArgv: ['--no-memory-protection-keys'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
  },
});

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
    include: ['test/**/*.test.ts'],
    // Per-test timeout is applied in the smoke test via `timeouts.spinUpPpgDev`;
    // use that as the hook ceiling too so `beforeEach`/`afterEach` can boot and
    // tear down @prisma/dev without the default 5s cap biting.
    testTimeout: timeouts.spinUpPpgDev,
    hookTimeout: timeouts.spinUpPpgDev,
  },
});

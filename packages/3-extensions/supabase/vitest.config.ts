import { timeouts } from '@repo/test-utils';
import { isCI } from 'ci-info';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Disable V8 PKU JIT write-protection in the test worker forks: PGlite
    // (WASM) teardown intermittently aborts on Linux without it. No-op on
    // macOS.
    execArgv: ['--no-memory-protection-keys'],
    // The reference-fixture restore is the heaviest WASM operation in the
    // repo; running several PGlite databases in parallel workers makes it
    // crash-prone (ECONNRESET mid-restore). One worker keeps the suite
    // deterministic — the same setting the example app used while it
    // hosted these tests. Per-file isolation stays on: supabase-facade
    // mocks the pg module, and a shared module registry would leak the
    // real pg into it (or the mock into the integration files).
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: timeouts.vitestPackageDefault,
    hookTimeout: timeouts.vitestPackageDefault,
    // Residual PGlite (WASM) abort on slower CI runners that
    // --no-memory-protection-keys only partially suppresses; a re-run with
    // a fresh dev database clears it. Does not reproduce locally.
    retry: isCI ? 2 : 0,
  },
});

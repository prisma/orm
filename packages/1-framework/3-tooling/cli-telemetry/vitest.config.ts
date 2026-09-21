import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Mirror the root config's harness short-circuit so the probe test in
    // `test/no-spawn-in-tests.test.ts` works under both `pnpm test:packages`
    // (root vitest, which injects the env) and `pnpm --filter @internal/cli-telemetry test`
    // (vitest reading only this package's config).
    env: {
      PRISMA_DISABLE_TELEMETRY: '1',
    },
  },
});

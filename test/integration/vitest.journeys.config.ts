import { timeouts } from '@repo/test-utils';
import { configDefaults, defineConfig } from 'vitest/config';
import { initJourneyExclude, setupFiles } from './vitest.config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles,
    include: ['test/cli-journeys/**/*.e2e.test.ts'],
    exclude: [...configDefaults.exclude, ...initJourneyExclude],
    testTimeout: timeouts.spinUpPpgDev,
    hookTimeout: timeouts.spinUpPpgDev,
    // Required (not a preference): journey helpers use process.chdir() and mock
    // process.exit/console globally. 'threads' would share these across tests.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
    // The PGlite (WASM) journeys still intermittently abort on the slower CI
    // runners even with --no-memory-protection-keys ("Connection terminated
    // unexpectedly"). The crash is environment-specific and does not reproduce
    // locally; a re-run with a fresh dev database clears it.
    retry: process.env['CI'] ? 2 : 0,
  },
});

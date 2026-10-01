import { timeouts } from '@repo/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Contract emission formats through prettier and pulls a large module
    // graph on first import. The 100ms default bets that neither costs
    // anything, which loses whenever the whole suite runs under load.
    testTimeout: timeouts.typeScriptCompilation,
    hookTimeout: timeouts.vitestPackageDefault,
  },
});

import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    watch: {
      // ignore generated files otherwise vitest will keep re-running tests in watch mode
      ignored: [...defaultExclude, '**/tests/generated/**'],
    },
  },
  test: {
    projects: [
      'packages/*',
      '!packages/cli',
      '!packages/client',
      '!packages/engine',
      '!packages/integration-tests',
      '!packages/internals',
      '!packages/migrate',
    ],
    testTimeout: 30_000,
  },
})

import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...defaultExclude, '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
})

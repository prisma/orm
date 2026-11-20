import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...defaultExclude, 'dist/**'],
  },
})

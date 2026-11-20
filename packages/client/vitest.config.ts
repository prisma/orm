import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      PRISMA_HIDE_PREVIEW_FLAG_WARNINGS: 'true',
    },
    exclude: [...configDefaults.exclude, 'src/__tests__/benchmarks/**'],
    include: ['src/**/*.test.ts'],
    testTimeout: 90_000,
  },
})

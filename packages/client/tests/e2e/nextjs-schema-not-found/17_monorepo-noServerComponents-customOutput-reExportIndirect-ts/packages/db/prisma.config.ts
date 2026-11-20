import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_E2E_POSTGRES_URI'),
  },
})

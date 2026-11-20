import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_POSTGRES_URI_MIGRATE'),
  },
})

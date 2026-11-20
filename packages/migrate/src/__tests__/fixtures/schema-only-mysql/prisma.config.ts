import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_MYSQL_URI_MIGRATE'),
  },
})

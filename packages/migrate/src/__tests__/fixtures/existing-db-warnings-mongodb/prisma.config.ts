import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_MONGO_URI_MIGRATE_EXISTING_DB'),
  },
})

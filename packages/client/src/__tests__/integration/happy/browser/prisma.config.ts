import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: env('SQLITE_URL_FROM_DOT_ENV_FILE'),
  },
})

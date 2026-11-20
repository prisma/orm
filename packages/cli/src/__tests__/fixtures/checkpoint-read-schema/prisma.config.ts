import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: env('SQLITE_URL'),
  },
})

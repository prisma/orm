import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('MYSQL_URL'),
  },
})

import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('POSTGRES_URL'),
  },
})

import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('UNDEFINED_VARIABLE'),
  },
})

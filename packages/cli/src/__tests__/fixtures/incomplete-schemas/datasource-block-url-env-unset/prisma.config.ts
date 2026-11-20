import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: env('SOME_UNDEFINED_DB'),
  },
})

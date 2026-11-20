import { defineConfig, env } from '@prisma/config'
export default defineConfig({
  datasource: {
    url: env('TEST_POSTGRES_URI_MIGRATE'),
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['public.User'],
  },
  migrations: {
    initShadowDb: `CREATE TABLE "User" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL);`,
  },
})

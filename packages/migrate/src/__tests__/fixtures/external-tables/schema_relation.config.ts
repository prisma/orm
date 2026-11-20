import path from 'node:path'

import { defineConfig, env } from '@prisma/config'

const basePath = process.cwd()

export default defineConfig({
  datasource: {
    url: env('TEST_POSTGRES_URI_MIGRATE'),
  },
  schema: path.join(basePath, 'schema_relation.prisma'),
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

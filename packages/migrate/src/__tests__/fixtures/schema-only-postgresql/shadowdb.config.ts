import path from 'node:path'

import { defineConfig, env } from '@prisma/config'

const basePath = process.cwd()

export default defineConfig({
  datasource: {
    url: env('TEST_POSTGRES_URI_MIGRATE'),
    shadowDatabaseUrl: env('TEST_POSTGRES_SHADOWDB_URI_MIGRATE'),
  },
  schema: path.join(basePath, 'prisma', 'shadowdb.prisma'),
})

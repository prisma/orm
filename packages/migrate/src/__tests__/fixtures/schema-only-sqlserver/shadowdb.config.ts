import path from 'node:path'

import { defineConfig, env } from '@prisma/config'

const basePath = process.cwd()

export default defineConfig({
  datasource: {
    url: env('TEST_MSSQL_JDBC_URI_MIGRATE'),
    shadowDatabaseUrl: env('TEST_MSSQL_SHADOWDB_JDBC_URI_MIGRATE'),
  },
  schema: path.join(basePath, 'prisma', 'shadowdb.prisma'),
})

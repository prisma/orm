import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_MSSQL_JDBC_URI'),
  },
})

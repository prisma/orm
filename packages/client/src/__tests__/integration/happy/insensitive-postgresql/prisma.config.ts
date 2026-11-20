import { defineConfig, env } from '@prisma/config'

const connectionString = env('TEST_POSTGRES_URI').replace('tests', 'tests-insensitive-postgresql')

export default defineConfig({
  datasource: {
    url: connectionString,
  },
})

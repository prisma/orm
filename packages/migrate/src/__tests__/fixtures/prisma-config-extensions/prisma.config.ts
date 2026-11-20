import { defineConfig, env } from '@prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_POSTGRES_URI_MIGRATE').replace('tests-migrate', `tests-migrate-prisma-config-extensions`),
  },
  experimental: {
    extensions: true,
  },
  extensions: [
    {
      types: [
        {
          prismaName: 'Vector3',
          dbName: 'vector',
          dbTypeModifiers: ['3'],
          numberOfDbTypeModifiers: 1,
        },
      ],
    },
  ],
})

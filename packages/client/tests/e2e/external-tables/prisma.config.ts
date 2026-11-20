import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_E2E_POSTGRES_URI'),
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['public.users'],
  },
  enums: {
    external: ['public.role'],
  },
  migrations: {
    // setup the users table for the shadow database
    initShadowDb: `
      CREATE TABLE public.users (id SERIAL PRIMARY KEY);
    `,
  },
})

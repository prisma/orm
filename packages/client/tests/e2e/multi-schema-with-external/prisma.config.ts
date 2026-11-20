import fs from 'node:fs'

import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('TEST_E2E_POSTGRES_URI'),
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['invoicing.Invoice'],
  },
  enums: {
    external: ['invoicing.InvoiceStatus'],
  },
  migrations: {
    initShadowDb: fs.readFileSync('./src/init.sql', 'utf-8'),
  },
})

import type { PrismaConfig } from 'src/index'

export default {
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['table1', 'specific_schema.table2'],
  },
} satisfies PrismaConfig

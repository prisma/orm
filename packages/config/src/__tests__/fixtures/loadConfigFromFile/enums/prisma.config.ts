import type { PrismaConfig } from 'src/index'

export default {
  experimental: {
    externalTables: true,
  },
  enums: {
    external: ['some_enum'],
  },
} satisfies PrismaConfig

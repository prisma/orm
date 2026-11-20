import type { PrismaConfig } from 'src/index'

export default {
  datasource: {
    url: 'file:./dev.db',
  },
} satisfies PrismaConfig

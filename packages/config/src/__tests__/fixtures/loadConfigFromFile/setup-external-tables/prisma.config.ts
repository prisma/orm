import type { PrismaConfig } from 'src/index'

export default {
  experimental: {
    externalTables: true,
  },
  migrations: {
    initShadowDb: `CREATE TABLE "User" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL);`,
  },
} satisfies PrismaConfig

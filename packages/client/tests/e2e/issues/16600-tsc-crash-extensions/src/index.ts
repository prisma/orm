import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

const adapter = new PrismaBetterSqlite3({
  url: './dev.db',
})

// this has caused tsc to crash with recursion limit exceeded for union comparison
export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter, log: ['query'] })

// this has caused tsc to crash with type node type serialization limit exceeded
export const prismaClient = new PrismaClient({ adapter }).$extends({})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

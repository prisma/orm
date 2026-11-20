import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '@prisma/client'

export const libsqlPrismaClient = new PrismaClient({
  adapter: new PrismaLibSql({
    url: 'libsql://test-prisma.turso.io',
    authToken: '',
  }),
})
void libsqlPrismaClient.user.findMany()

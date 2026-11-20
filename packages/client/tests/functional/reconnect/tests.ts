import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

testMatrix.setupTestSuite(
  () => {
    test('can disconnect and reconnect', async () => {
      const prisma = newPrismaClient({})
      await prisma.user.findMany()
      await prisma.$disconnect()
      await prisma.$connect()
      await prisma.user.findMany()
    })
  },
  {
    skipDriverAdapter: {
      from: ['js_pg_cockroachdb'],
      reason:
        'Tracked in https://linear.app/prisma-company/issue/ORM-1361/fix-can-disconnect-and-reconnect-for-pg-cockroachdb',
    },
  },
)

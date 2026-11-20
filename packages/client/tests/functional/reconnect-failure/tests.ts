import { Providers } from '../_utils/providers'
import { Db, NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>
declare const db: Db

let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('example', async () => {
      // Ensure that the db is down
      await db.dropDb()

      prisma = newPrismaClient({})

      // Try sending a query without a spawned database
      await expect(prisma.user.findMany()).rejects.toThrow()

      // Spawn the database
      await db.setupDb()

      // Expect it to work
      await expect(prisma.user.findMany()).resolves.toEqual([])
    })
  },
  {
    skipDb: true, // So we can manually spawn the database
    skipDefaultClientInstance: true, // So we can manually call connect for this test
    optOut: {
      from: [Providers.MONGODB],
      reason: 'First query does not fail even when database does not exist.',
    },
    skipDriverAdapter: {
      // TODO: fix this case
      from: ['js_mssql'],
      reason: 'Driver fails with `Login failed for user ...`',
    },
    skip(when, { clientEngineExecutor }) {
      when(clientEngineExecutor === 'remote', "Fails because it's not an Accelerate URL.")
    },
  },
)

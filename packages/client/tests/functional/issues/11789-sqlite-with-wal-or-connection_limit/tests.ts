import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

import { Db, NewPrismaClient } from '../../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

// the rest is from npx prisma migrate diff --from-empty --to-schema=...
const sqlDef = `CREATE TABLE "User" (
   "id" TEXT NOT NULL PRIMARY KEY,
   "email" TEXT NOT NULL
);
CREATE TABLE "Profile" (
   "id" TEXT NOT NULL PRIMARY KEY,
   "userId" TEXT NOT NULL,
   CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId")`

declare const db: Db

/**
 * tests for #11789
 */
testMatrix.setupTestSuite(
  ({ driverAdapter }) => {
    async function createUsers(prisma: PrismaClient, ids: string[]) {
      for (const id of ids) {
        await prisma.user.create({
          data: {
            id,
            email: `${id}@test.com`,
          },
        })
      }
    }

    function upsertProfilesConcurrently(prisma: PrismaClient, ids: string[]) {
      return Promise.all(
        ids.map((id) =>
          prisma.profile.upsert({
            update: {},
            where: {
              id,
            },
            create: {
              user: {
                connect: {
                  id,
                },
              },
            },
          }),
        ),
      )
    }

    function deleteUsersConcurrently(prisma: PrismaClient, ids: string[]) {
      return Promise.all(
        ids.map((id) =>
          prisma.user.delete({
            where: {
              id,
            },
          }),
        ),
      )
    }

    testIf(driverAdapter === 'js_d1')('D1 does not support journal_mode = WAL', async () => {
      const prisma = newPrismaClient({})
      expect.assertions(1)

      try {
        await prisma.$queryRaw`PRAGMA journal_mode = WAL`
      } catch (error) {
        const e = error as Error
        expect(e.message).toContain('D1_ERROR: not authorized')
      }
    })

    describeIf(driverAdapter === undefined)('default case: no Driver Adapter', () => {
      test('5 concurrent upsert should succeed with journal_mode = WAL', async () => {
        await db.dropDb()

        const adapter = new PrismaBetterSqlite3({
          url: './concurrent-upsert-wal.db',
        })
        const prisma = newPrismaClient({ adapter })

        await expect(prisma.$queryRaw`PRAGMA journal_mode = WAL`).resolves.toEqual([{ journal_mode: 'wal' }])

        const ddlQueries = [] as any[]
        sqlDef.split(';').forEach((sql) => {
          ddlQueries.push(prisma.$executeRawUnsafe(sql))
        })
        await prisma.$transaction(ddlQueries)

        const N = 5
        const ids = Array.from({ length: N }, (_, i) => `${i + 1}`.padStart(5, '0'))
        await createUsers(prisma, ids)

        const queries = await upsertProfilesConcurrently(prisma, ids)

        expect(queries).toHaveLength(N)
      })

      test('5 concurrent upsert should succeed with connection_limit=1 & journal_mode = WAL', async () => {
        await db.dropDb()

        const adapter = new PrismaBetterSqlite3({
          url: './concurrent-upsert-conn-wal.db?connection_limit=1',
        })
        const prisma = newPrismaClient({ adapter })

        await expect(prisma.$queryRaw`PRAGMA journal_mode = WAL`).resolves.toEqual([{ journal_mode: 'wal' }])

        const ddlQueries: any = []
        sqlDef.split(';').forEach((sql) => {
          ddlQueries.push(prisma.$executeRawUnsafe(sql))
        })
        await prisma.$transaction(ddlQueries)

        const N = 5
        const ids = Array.from({ length: N }, (_, i) => `${i + 1}`.padStart(5, '0'))
        await createUsers(prisma, ids)

        const queries = await upsertProfilesConcurrently(prisma, ids)

        expect(queries).toHaveLength(N)
      })

      test('5 concurrent upsert should succeed with connection_limit=1', async () => {
        await db.dropDb()

        const adapter = new PrismaBetterSqlite3({
          url: './concurrent-upsert.db?connection_limit=1',
        })
        const prisma = newPrismaClient({ adapter })

        const ddlQueries: any = []
        sqlDef.split(';').forEach((sql) => {
          ddlQueries.push(prisma.$executeRawUnsafe(sql))
        })
        await prisma.$transaction(ddlQueries)

        const N = 5
        const ids = Array.from({ length: N }, (_, i) => `${i + 1}`.padStart(5, '0'))
        await createUsers(prisma, ids)

        const queries = await upsertProfilesConcurrently(prisma, ids)

        expect(queries).toHaveLength(N)
      })

      test('5 concurrent delete should succeed with connection_limit=1', async () => {
        await db.dropDb()

        const adapter = new PrismaBetterSqlite3({
          url: './concurrent-delete.db?connection_limit=1',
        })
        const prisma = newPrismaClient({ adapter })

        const ddlQueries: any = []
        sqlDef.split(';').forEach((sql) => {
          ddlQueries.push(prisma.$executeRawUnsafe(sql))
        })
        await prisma.$transaction(ddlQueries)

        const N = 5
        const ids = Array.from({ length: N }, (_, i) => `${i + 1}`.padStart(5, '0'))
        await createUsers(prisma, ids)

        const queries = await deleteUsersConcurrently(prisma, ids)

        expect(queries).toHaveLength(N)
      })
    })
  },
  {
    skipDb: true,
    skipDefaultClientInstance: true,
    optOut: {
      from: ['sqlserver', 'mongodb', 'postgresql', 'cockroachdb', 'mysql'],
      reason: 'Test is made for SQLite only',
    },
    skip: (when, { driverAdapter }) => {
      when(driverAdapter !== 'js_better_sqlite3', 'We only need to test it on `js_better_sqlite3`')
    },
  },
)

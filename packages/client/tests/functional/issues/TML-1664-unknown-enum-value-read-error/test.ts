import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

/**
 * Regression test for DataMapperError when reading unknown enum values.
 *
 * When the database contains an enum value that Prisma doesn't know about
 * (e.g., a value added directly to the database after schema generation),
 * reading the data should return a proper user-facing error (P2023)
 * rather than throwing an internal error.
 *
 * This test adds a new enum value to the database that Prisma schema
 * doesn't define, inserts a row with that value, then attempts to read it.
 */
testMatrix.setupTestSuite(
  () => {
    beforeAll(async () => {
      // Add a new enum value to the database that Prisma doesn't know about
      await prisma.$executeRawUnsafe(`ALTER TYPE "Status" ADD VALUE 'UNKNOWN_TO_PRISMA'`)

      // Insert a row with the unknown enum value
      await prisma.$executeRawUnsafe(`INSERT INTO "User" ("id", "status") VALUES ('1', 'UNKNOWN_TO_PRISMA')`)
    })

    test('returns P2023 error when reading enum value unknown to Prisma', async () => {
      const result = await prisma.user.findMany().catch((e) => e)

      expect(result.name).toBe('PrismaClientKnownRequestError')
      expect(result.code).toBe('P2023')
      expect(result.message).toContain("Value 'UNKNOWN_TO_PRISMA' not found in enum 'Status'")
    })
  },
  {
    optOut: {
      from: ['mysql', 'cockroachdb', 'mongodb', 'sqlite', 'sqlserver'],
      reason: 'Test uses PostgreSQL-specific ALTER TYPE syntax for enum modification',
    },
  },
)

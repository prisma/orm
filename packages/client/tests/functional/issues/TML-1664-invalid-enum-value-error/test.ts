import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

/**
 * Regression test for invalid enum value error handling.
 *
 * When PostgreSQL rejects an invalid enum value with error code 22P02
 * (invalid_text_representation), the error should be properly converted
 * to a user-facing error (P2007).
 *
 * This test creates a mismatch between the Prisma schema enum and the database
 * enum by modifying the database enum after migration, then attempts to insert
 * a value that exists in the Prisma schema but not in the database.
 */
testMatrix.setupTestSuite(
  () => {
    beforeAll(async () => {
      // Remove PENDING from the database enum to create a mismatch with Prisma schema
      // We need to recreate the enum type since PostgreSQL doesn't allow removing values
      await prisma.$executeRawUnsafe(`
        -- Remove the default constraint temporarily
        ALTER TABLE "User" ALTER COLUMN "status" DROP DEFAULT;

        -- Create a new enum type without PENDING
        CREATE TYPE "Status_new" AS ENUM ('ACTIVE', 'INACTIVE');

        -- Update the column to use the new type
        ALTER TABLE "User" ALTER COLUMN "status" TYPE "Status_new" USING "status"::text::"Status_new";

        -- Drop the old type and rename the new one
        DROP TYPE "Status";
        ALTER TYPE "Status_new" RENAME TO "Status";
      `)
    })

    test('returns P2007 error when inserting enum value that does not exist in database', async () => {
      // PENDING exists in Prisma schema but not in database enum anymore
      // This should trigger PostgreSQL error 22P02 (invalid_text_representation)
      // which should be mapped to P2007 (Data validation error)
      const result = await prisma.user
        .create({
          data: {
            status: 'PENDING',
          },
        })
        .catch((e) => e)

      expect(result.name).toBe('PrismaClientKnownRequestError')
      expect(result.code).toBe('P2007')
      expect(result.message).toContain('invalid input value for enum')
    })
  },
  {
    optOut: {
      from: ['mysql', 'cockroachdb', 'mongodb', 'sqlite', 'sqlserver'],
      reason: 'Testing PostgreSQL-specific enum error handling',
    },
  },
)

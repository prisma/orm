import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

/**
 * Regression test for unmapped driver adapter errors being surfaced as
 * user-facing errors (P2039) instead of leaking as opaque
 * `PrismaClientUnknownRequestError`s (or, on Accelerate, as HTTP 500s
 * whose body is stripped by the edge).
 *
 * This reproduces a real production incident where a user's `upsert()`
 * query triggered Postgres error 42P10 ("there is no unique or exclusion
 * constraint matching the ON CONFLICT specification") because the unique
 * constraint backing the upsert had been dropped from the database
 * (schema drift: the Prisma schema still declared `@unique`, but the DB
 * column was no longer unique). 42P10 is not specifically mapped by the
 * Postgres driver adapter, so the error arrives at
 * `rethrowAsUserFacing()` with `kind: 'postgres'`.
 *
 * Before the fix, `rethrowAsUserFacing()` re-threw the raw
 * `DriverAdapterError` for these generic database kinds, which:
 *   - surfaced locally as `PrismaClientUnknownRequestError`, and
 *   - was returned as HTTP 500 from the query plan executor, causing
 *     Accelerate to strip the response body and leave the customer
 *     debugging a generic P6000 with no underlying message.
 *
 * After the fix, unmapped database-specific kinds fall back to a P2039
 * `UserFacingError` ("Database error. Code: X. Message: Y") that carries
 * the real DB code and message, which both clients and Accelerate
 * forward unchanged.
 */
testMatrix.setupTestSuite(
  () => {
    beforeAll(async () => {
      // Simulate schema drift: the Prisma schema declares `email @unique`,
      // but the DB column has no unique constraint. This causes upserts
      // targeting `email` to fail with Postgres 42P10.
      //
      // `prisma db push` creates the `@unique` on `email` as a unique
      // *index* (not a table constraint), so we need to drop the index to
      // remove the uniqueness guarantee.
      await prisma.$executeRawUnsafe(`DROP INDEX "User_email_key"`)
    })

    test('returns P2039 with the original DB code and message for unmapped Postgres errors', async () => {
      const result = await prisma.user
        .upsert({
          where: { email: 'alice@example.com' },
          create: { email: 'alice@example.com', name: 'Alice' },
          update: { name: 'Alice' },
        })
        .catch((e) => e)

      expect(result.name).toBe('PrismaClientKnownRequestError')
      expect(result.code).toBe('P2039')
      expect(result.message).toContain('42P10')
      expect(result.message).toContain(
        'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      )
      expect(result.message).toMatch(/Database error\. Code: `42P10`\. Message: `/)
    })
  },
  {
    optOut: {
      from: ['mysql', 'cockroachdb', 'mongodb', 'sqlite', 'sqlserver'],
      reason:
        'Test reproduces PostgreSQL error 42P10 ("no unique or exclusion constraint matching the ON CONFLICT specification") by dropping a PostgreSQL unique index, which has no direct equivalent on other providers',
    },
  },
)

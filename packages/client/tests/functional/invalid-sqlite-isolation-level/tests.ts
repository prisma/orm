import testMatrix from './_matrix'
// @ts-ignore
import type * as $ from './generated/prisma/client'

declare let prisma: $.PrismaClient

testMatrix.setupTestSuite(
  ({ driverAdapter }) => {
    testIf(driverAdapter !== undefined)('invalid level generates run- and compile- time error', async () => {
      // @ts-expect-error
      const result = prisma.$transaction([prisma.user.findFirst({}), prisma.user.findFirst({})], {
        isolationLevel: 'ReadUncommitted',
      })

      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.$transaction([prisma.user.findFirst()\` invocation in
        /client/tests/functional/invalid-sqlite-isolation-level/tests.ts:0:0

           XX ({ driverAdapter }) => {
           XX   testIf(driverAdapter !== undefined)('invalid level generates run- and compile- time error', async () => {
          XX     // @ts-expect-error
        → XX     const result = prisma.$transaction([prisma.user.findFirst(
        Error in connector: Conversion error: READ UNCOMMITTED"
      `)
    })
  },
  {
    optOut: {
      from: ['postgresql', 'mysql', 'mongodb', 'cockroachdb', 'sqlserver'],
      reason: `
        The isolation level check is specific to SQLite.
      `,
    },
  },
)

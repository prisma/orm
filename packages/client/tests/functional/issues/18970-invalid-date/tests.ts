import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(() => {
  test('throws on invalid date (json)', async () => {
    await expect(
      prisma.user.findMany({
        where: {
          date: new Date('I am not a date'),
        },
      }),
    ).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.findMany()\` invocation in
        /client/tests/functional/issues/18970-invalid-date/tests.ts:0:0

           XX testMatrix.setupTestSuite(() => {
           XX   test('throws on invalid date (json)', async () => {
           XX     await expect(
        → XX       prisma.user.findMany({
                     where: {
                       date: new Date("Invalid Date")
                             ~~~~~~~~~~~~~~~~~~~~~~~~
                     }
                   })

        Invalid value for argument \`date\`: Provided Date object is invalid. Expected Date."
      `)
  })
})

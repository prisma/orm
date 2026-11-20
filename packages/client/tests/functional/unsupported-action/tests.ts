import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare let prisma: PrismaClient

testMatrix.setupTestSuite(
  () => {
    test('unsupported method', async () => {
      // @ts-expect-error
      const result = prisma.user.aggregateRaw()
      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.user.aggregateRaw()\` invocation in
        /client/tests/functional/unsupported-action/tests.ts:0:0

           XX () => {
          XX   test('unsupported method', async () => {
          XX     // @ts-expect-error
        → XX     const result = prisma.user.aggregateRaw(
        Operation 'aggregateRaw' for model 'User' does not match any query."
      `)
    })
  },
  {
    optOut: {
      from: [Providers.MONGODB],
      reason: 'Test uses aggregateRaw as an example of unsupported method for SQL databases, it exists on mongo',
    },
  },
)

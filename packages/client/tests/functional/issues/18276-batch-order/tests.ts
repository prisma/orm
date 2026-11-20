import { Providers } from '../../_utils/providers'
import { waitFor } from '../../_utils/tests/waitFor'
import { NewPrismaClient } from '../../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

testMatrix.setupTestSuite(
  ({ provider, driverAdapter, clientEngineExecutor }) => {
    const isSqlServer = provider === Providers.SQLSERVER
    const usesJsDrivers = driverAdapter !== undefined || clientEngineExecutor === 'remote'

    test('executes batch queries in the right order when using extensions + middleware', async () => {
      const prisma = newPrismaClient({
        log: [{ emit: 'event', level: 'query' }],
      })

      const queries: string[] = []

      // @ts-expect-error - client not typed for log opts for cross generator compatibility - can be improved once we drop the prisma-client-js generator
      prisma.$on('query', ({ query }) => queries.push(query))

      const xprisma = prisma.$extends({
        query: {
          async $queryRawUnsafe({ args, query }) {
            const [, result] = await prisma.$transaction([
              prisma.$queryRawUnsafe('SELECT 1'),
              query(args),
              prisma.$queryRawUnsafe('SELECT 3'),
            ])
            return result
          },
        },
      })

      await xprisma.$queryRawUnsafe('SELECT 2')

      const expectation = ['SELECT 1', 'SELECT 2', 'SELECT 3', expect.stringContaining('COMMIT')]
      if (!usesJsDrivers) {
        // Driver adapters do not issue BEGIN through the query engine.
        expectation.unshift(expect.stringContaining('BEGIN'))
      }
      if (isSqlServer && !usesJsDrivers) {
        expectation.unshift(expect.stringContaining('SET TRANSACTION'))
      }

      await waitFor(() => expect(queries).toEqual(expectation))
    })

    test('executes batch in right order when using delayed middleware', async () => {
      const prisma = newPrismaClient({
        log: [{ emit: 'event', level: 'query' }],
      })

      const queries: string[] = []

      // @ts-expect-error - client not typed for log opts for cross generator compatibility - can be improved once we drop the prisma-client-js generator
      prisma.$on('query', ({ query }) => queries.push(query))

      await prisma.$transaction([
        prisma.$queryRawUnsafe('SELECT 1'),
        prisma.$queryRawUnsafe('SELECT 2'),
        prisma.$queryRawUnsafe('SELECT 3'),
      ])

      const expectation = ['SELECT 1', 'SELECT 2', 'SELECT 3', expect.stringContaining('COMMIT')]
      if (!usesJsDrivers) {
        // Driver adapters do not issue BEGIN through the query engine.
        expectation.unshift(expect.stringContaining('BEGIN'))
      }
      if (isSqlServer && !usesJsDrivers) {
        expectation.unshift(expect.stringContaining('SET TRANSACTION'))
      }

      await waitFor(() => expect(queries).toEqual(expectation))
    })
  },
  {
    skipDefaultClientInstance: true,
    optOut: {
      from: [Providers.MONGODB],
      reason: 'Test uses raw SQL queries',
    },
  },
)

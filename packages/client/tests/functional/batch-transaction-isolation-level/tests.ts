import { Providers } from '../_utils/providers'
import { waitFor } from '../_utils/tests/waitFor'
import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { Prisma as PrismaNamespace, PrismaClient } from './generated/prisma/client'

declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>
declare let Prisma: typeof PrismaNamespace

testMatrix.setupTestSuite(
  ({ provider, driverAdapter, clientEngineExecutor }, _suiteMeta, _clientMeta) => {
    const isSqlServer = provider === Providers.SQLSERVER
    const isCockroachDb = provider === Providers.COCKROACHDB
    const usesJsDrivers = driverAdapter !== undefined || clientEngineExecutor === 'remote'

    const queries: string[] = []
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = newPrismaClient({
        log: [
          {
            emit: 'event',
            level: 'query',
          },
        ],
      })

      // @ts-expect-error - client not typed for log opts for cross generator compatibility - can be improved once we drop the prisma-client-js generator
      prisma.$on('query', (event: Prisma.QueryEvent) => {
        queries.push(event.query)
      })
    })

    afterEach(() => {
      queries.length = 0
    })

    const testIsolationLevel = (
      name: string,
      {
        level,
        onlyIf,
        expectSql,
      }: { level: () => PrismaNamespace.TransactionIsolationLevel; onlyIf?: () => boolean; expectSql: string },
    ) => {
      // Driver adapters do not issue SET TRANSACTION ISOLATION LEVEL through the query engine.
      testIf(!usesJsDrivers && (onlyIf ? onlyIf() : true))(name, async () => {
        await prisma.$transaction([prisma.user.findFirst({}), prisma.user.findFirst({})], {
          isolationLevel: level(),
        })

        await waitFor(() => {
          expect(queries).toContain(expectSql)
        })
      })
    }

    testIsolationLevel('ReadUncommitted', {
      // @ts-test-if: !['cockroachdb'].includes(provider)
      level: () => Prisma.TransactionIsolationLevel.ReadUncommitted,
      onlyIf: () => !isCockroachDb,
      expectSql: 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED',
    })

    testIsolationLevel('ReadCommitted', {
      level: () => Prisma.TransactionIsolationLevel.ReadCommitted,
      expectSql: 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
    })

    testIsolationLevel('RepeatableRead', {
      // @ts-test-if: !['cockroachdb'].includes(provider)
      level: () => Prisma.TransactionIsolationLevel.RepeatableRead,
      onlyIf: () => !isCockroachDb,
      expectSql: 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    })

    testIsolationLevel('Serializable', {
      level: () => Prisma.TransactionIsolationLevel.Serializable,
      expectSql: 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    })

    test('default value generates no SET TRANSACTION ISOLATION LEVEL statements (unless running MSSQL)', async () => {
      await prisma.$transaction([prisma.user.findFirst({}), prisma.user.findFirst({})])

      const match = queries.find((q) => q.includes('SET TRANSACTION ISOLATION LEVEL'))
      if (isSqlServer && !usesJsDrivers) {
        expect(match).toBeDefined()
      } else {
        expect(match).toBeUndefined()
      }
    })

    test('invalid level generates run- and compile- time error', async () => {
      // @ts-expect-error
      const result = prisma.$transaction([prisma.user.findFirst({}), prisma.user.findFirst({})], {
        isolationLevel: 'yes',
      })

      await expect(result).rejects.toMatchPrismaErrorInlineSnapshot(`
        "
        Invalid \`prisma.$transaction([prisma.user.findFirst()\` invocation in
        /client/tests/functional/batch-transaction-isolation-level/tests.ts:0:0

          XX 
          XX test('invalid level generates run- and compile- time error', async () => {
          XX   // @ts-expect-error
        → XX   const result = prisma.$transaction([prisma.user.findFirst(
        Inconsistent column data: Conversion failed: Invalid isolation level \`yes\`"
      `)
    })
  },
  {
    optOut: {
      from: ['mongodb', 'sqlite'],
      reason: `
        mongo - Not supported
        sqlite, cockroach - Support only serializable level, never generate sql for setting isolation level
      `,
    },
    skipDefaultClientInstance: true,
  },
)

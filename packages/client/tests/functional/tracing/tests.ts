import { faker } from '@faker-js/faker'
import { Attributes, context, SpanKind, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { PrismaInstrumentation } from '@prisma/instrumentation'

import { AdapterProviders, Providers, RelationModes } from '../_utils/providers'
import { waitFor } from '../_utils/tests/waitFor'
import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

type Tree = {
  name: string
  kind?: string | undefined
  attributes?: Attributes
  children?: Tree[]
}

declare let prisma: PrismaClient
declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

let inMemorySpanExporter: InMemorySpanExporter
let processor: SpanProcessor

beforeAll(() => {
  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)

  inMemorySpanExporter = new InMemorySpanExporter()
  processor = new SimpleSpanProcessor(inMemorySpanExporter)

  const basicTracerProvider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'test-name',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    spanProcessors: [processor],
  })

  trace.setGlobalTracerProvider(basicTracerProvider)

  registerInstrumentations({
    instrumentations: [new PrismaInstrumentation()],
  })
})

afterAll(() => {
  context.disable()
})

beforeEach(() => {
  prisma = newPrismaClient()
})

afterEach(async () => {
  await prisma.$disconnect()
})

testMatrix.setupTestSuite(
  ({ provider, driverAdapter, relationMode, clientEngineExecutor }, _suiteMeta, clientMeta) => {
    const executorSpanInfix = clientEngineExecutor === 'remote' ? 'accelerate' : 'client'

    function buildTree(rootSpan: ReadableSpan, spans: ReadableSpan[]): Tree {
      const childrenSpans = spans
        .sort((a, b) => {
          const normalizeNameForComparison = (name: string) => {
            // Replace client engine specific spans with their classic names as sort keys
            // to ensure stable order regardless of the engine type.
            const prefix = `prisma:${executorSpanInfix}`
            if (
              [
                `${prefix}:db_query`,
                `${prefix}:start_transaction`,
                `${prefix}:commit_transaction`,
                `${prefix}:rollback_transaction`,
              ].includes(name)
            ) {
              return 'prisma:engine:' + name.slice(`${prefix}:`.length)
            }
            return name
          }
          // Ensures fixed order of children spans regardless of the
          // actual timings. Why use name instead of start time? Sometimes
          // things happen in parallel/different order and startTime does not
          // provide stable ordering guarantee.
          return normalizeNameForComparison(a.name).localeCompare(normalizeNameForComparison(b.name))
        })
        .filter((span) => span.parentSpanContext?.spanId === rootSpan.spanContext().spanId)

      const tree: Tree = {
        name: rootSpan.name,
      }

      if (childrenSpans.length > 0) {
        tree.children = childrenSpans.map((span) => buildTree(span, spans))
      }

      if (Object.keys(rootSpan.attributes).length > 0) {
        tree.attributes = rootSpan.attributes
      }

      if (rootSpan.kind !== SpanKind.INTERNAL) {
        tree.kind = SpanKind[rootSpan.kind]
      }

      return tree
    }

    const isMongoDb = provider === Providers.MONGODB
    const isMySql = provider === Providers.MYSQL
    const isSqlServer = provider === Providers.SQLSERVER
    const usesJsDrivers = driverAdapter !== undefined || clientEngineExecutor === 'remote'

    const usesSyntheticTxQueries =
      (driverAdapter !== undefined &&
        ['js_d1', 'js_libsql', 'js_planetscale', 'js_mssql', 'js_mariadb'].includes(driverAdapter)) ||
      (clientEngineExecutor === 'remote' && [Providers.SQLSERVER, Providers.MYSQL].includes(provider))

    beforeEach(async () => {
      await prisma.$connect()
      inMemorySpanExporter.reset()
    })

    async function waitForSpanTree(expectedTree: Tree | Tree[]): Promise<void> {
      await waitFor(async () => {
        await processor.forceFlush()
        const spans = inMemorySpanExporter.getFinishedSpans()
        const rootSpans = spans.filter((span) => !span.parentSpanContext?.spanId)
        const trees = rootSpans.map((rootSpan) => buildTree(rootSpan, spans))

        if (Array.isArray(expectedTree)) {
          expect(trees).toEqual(expectedTree)
        } else {
          expect(trees[0]).toEqual(expectedTree)
        }
      })
    }

    function dbQuery(statement: string): Tree {
      const span = {
        name: `prisma:${executorSpanInfix}:db_query`,
        kind: 'CLIENT',
        attributes: {
          'db.query.text': statement,
          'db.system.name': dbSystemExpectation(),
        },
      }

      if (provider === Providers.MONGODB) {
        span.attributes['db.operation.name'] = expect.toBeString()
      }

      return span
    }

    function txSetIsolationLevel() {
      if (usesSyntheticTxQueries) {
        return dbQuery('-- Implicit "SET TRANSACTION" query via underlying driver')
      } else {
        return dbQuery(expect.stringContaining('SET TRANSACTION'))
      }
    }

    function txBegin() {
      if (usesSyntheticTxQueries) {
        return dbQuery('-- Implicit "BEGIN" query via underlying driver')
      } else {
        return dbQuery(expect.stringContaining('BEGIN'))
      }
    }

    function txCommit() {
      if (usesSyntheticTxQueries) {
        return dbQuery('-- Implicit "COMMIT" query via underlying driver')
      } else {
        return dbQuery('COMMIT')
      }
    }

    function txRollback() {
      if (usesSyntheticTxQueries) {
        return dbQuery('-- Implicit "ROLLBACK" query via underlying driver')
      } else {
        return dbQuery('ROLLBACK')
      }
    }

    function operation(model: string | undefined, method: string, children: Tree[]) {
      const attributes: Attributes = {
        method,
        name: model ? `${model}.${method}` : method,
      }

      if (model) {
        attributes.model = model
      }
      return {
        name: 'prisma:client:operation',
        attributes,
        children,
      }
    }

    function engine(children: Tree[]) {
      return children
    }

    function clientCompile(action: string, model?: string) {
      return clientCompileBatch([action], model ? [model] : [])
    }

    function clientCompileBatch(actions: string[], models: string[]) {
      return [
        {
          name: 'prisma:client:compile',
          attributes: { actions, models },
        },
      ]
    }

    function clientSerialize() {
      return { name: 'prisma:client:serialize' }
    }

    function dbSystemExpectation() {
      return expect.toSatisfy((dbSystem) => {
        if (provider === Providers.SQLSERVER) {
          return dbSystem === 'mssql'
        }
        return dbSystem === provider
      })
    }

    function engineConnect() {
      return undefined
    }

    function findManyDbQuery() {
      const statement = isMongoDb ? 'db.User.aggregate' : 'SELECT'

      return dbQuery(expect.stringContaining(statement))
    }

    function createDbQueries(tx = true) {
      if (isMongoDb) {
        return [
          dbQuery(expect.stringContaining('db.User.insertOne')),
          dbQuery(expect.stringContaining('db.User.aggregate')),
        ]
      }

      if (['postgresql', 'cockroachdb', 'sqlite'].includes(provider)) {
        return [dbQuery(expect.stringContaining('INSERT'))]
      }

      const dbQueries: Tree[] = []
      if (tx) {
        if (isSqlServer && !usesJsDrivers) {
          dbQueries.push(txSetIsolationLevel())
        }
        if (!usesJsDrivers) {
          // Driver adapters do not issue BEGIN through the query engine.
          dbQueries.push(txBegin())
        }
        // The order looks weird (first commit, then start) because spans
        // are sorted by span name.
        dbQueries.push(itxOperation('commit'))
      }

      dbQueries.push(dbQuery(expect.stringContaining('INSERT')), dbQuery(expect.stringContaining('SELECT')))

      if (tx) {
        dbQueries.push(itxOperation('start'))
      }
      return dbQueries
    }

    function itxOperation(operation: 'start' | 'commit' | 'rollback'): Tree {
      const name = `prisma:${executorSpanInfix}:${operation}_transaction`

      let children: Tree[] | undefined

      if (operation === 'start') {
        children = isMongoDb
          ? []
          : isSqlServer && !usesJsDrivers
            ? [txSetIsolationLevel(), txBegin()]
            : !usesJsDrivers
              ? [txBegin()]
              : undefined
      } else if (operation === 'commit') {
        children = isMongoDb ? undefined : [txCommit()]
      } else if (operation === 'rollback') {
        children = isMongoDb ? undefined : [txRollback()]
      }

      return {
        name,
        children,
      }
    }

    describe('tracing on crud methods', () => {
      let sharedEmail = faker.internet.email()

      test('create', async () => {
        await prisma.user.create({
          data: {
            email: sharedEmail,
          },
        })

        await waitForSpanTree(
          operation('User', 'create', [
            ...clientCompile('createOne', 'User'),
            clientSerialize(),
            ...engine([...createDbQueries()]),
          ]),
        )
      })

      test('read', async () => {
        await prisma.user.findMany({
          where: {
            email: sharedEmail,
          },
        })

        await waitForSpanTree(
          operation('User', 'findMany', [
            ...clientCompile('findMany', 'User'),
            clientSerialize(),
            ...engine([findManyDbQuery()]),
          ]),
        )
      })

      test('update', async () => {
        const newEmail = faker.internet.email()

        await prisma.user.update({
          data: {
            email: newEmail,
          },
          where: {
            email: sharedEmail,
          },
        })

        sharedEmail = newEmail

        let expectedDbQueries: Tree[]

        if (isMongoDb) {
          expectedDbQueries = [
            dbQuery(expect.stringContaining('db.User.aggregate')),
            dbQuery(expect.stringContaining('db.User.updateMany')),
            dbQuery(expect.stringContaining('db.User.aggregate')),
          ]
        } else if (['postgresql', 'cockroachdb', 'sqlite'].includes(provider)) {
          expectedDbQueries = [dbQuery(expect.stringContaining('UPDATE'))]
        } else {
          expectedDbQueries = [
            dbQuery(expect.stringContaining('SELECT')),
            dbQuery(expect.stringContaining('UPDATE')),
            dbQuery(expect.stringContaining('SELECT')),
          ]
          if (!usesJsDrivers) {
            // Driver adapters do not issue BEGIN through the query engine.
            expectedDbQueries.unshift(txBegin())
          }
          if (isSqlServer && !usesJsDrivers) {
            expectedDbQueries.unshift(txSetIsolationLevel())
          }
          expectedDbQueries.push(itxOperation('start'))
          expectedDbQueries.unshift(itxOperation('commit'))
        }

        await waitForSpanTree(
          operation('User', 'update', [
            ...clientCompile('updateOne', 'User'),
            clientSerialize(),
            ...engine([...expectedDbQueries]),
          ]),
        )
      })

      test('delete', async () => {
        await prisma.user.delete({
          where: {
            email: sharedEmail,
          },
        })

        let expectedDbQueries: Tree[]

        if (isMongoDb) {
          expectedDbQueries = [dbQuery(expect.stringContaining('db.User.findAndModify'))]
        } else if (isMySql || isSqlServer) {
          expectedDbQueries = [dbQuery(expect.stringContaining('SELECT')), dbQuery(expect.stringContaining('DELETE'))]
          if (!usesJsDrivers) {
            // Driver adapters do not issue BEGIN through the query engine.
            expectedDbQueries.unshift(txBegin())
          }
          if (isSqlServer && !usesJsDrivers) {
            expectedDbQueries.unshift(txSetIsolationLevel())
          }
          expectedDbQueries.push(itxOperation('start'))
          expectedDbQueries.unshift(itxOperation('commit'))
        } else {
          expectedDbQueries = [dbQuery(expect.stringContaining('DELETE'))]
        }
        await waitForSpanTree(
          operation('User', 'delete', [
            ...clientCompile('deleteOne', 'User'),
            clientSerialize(),
            ...engine([...expectedDbQueries]),
          ]),
        )
      })

      test('deleteMany()', async () => {
        // Needed to see `deleteMany` for MongoDB
        // for context https://github.com/prisma/prisma-engines/blob/a437f71ab038893c0001b09743862e841bedca01/query-engine/connectors/mongodb-query-connector/src/root_queries/write.rs#L259-L261
        await prisma.user.create({
          data: {
            email: sharedEmail,
          },
        })
        inMemorySpanExporter.reset()

        await prisma.user.deleteMany()

        let expectedDbQueries: Tree[]

        if (isMongoDb) {
          expectedDbQueries = [
            dbQuery(expect.stringContaining('db.User.aggregate')),
            dbQuery(expect.stringContaining('db.User.deleteMany')),
          ]
        } else if (relationMode === RelationModes.PRISMA) {
          expectedDbQueries = [dbQuery(expect.stringContaining('SELECT')), dbQuery(expect.stringContaining('DELETE'))]
          if (!usesJsDrivers) {
            // Driver adapters do not issue BEGIN through the query engine.
            expectedDbQueries.unshift(txBegin())
          }
          if (isSqlServer && !usesJsDrivers) {
            expectedDbQueries.unshift(txSetIsolationLevel())
          }
          expectedDbQueries.push(itxOperation('start'))
          expectedDbQueries.unshift(itxOperation('commit'))
        } else {
          expectedDbQueries = [dbQuery(expect.stringContaining('DELETE'))]
        }

        await waitForSpanTree(
          operation('User', 'deleteMany', [
            ...clientCompile('deleteMany', 'User'),
            clientSerialize(),
            ...engine([...expectedDbQueries]),
          ]),
        )
      })

      test('count', async () => {
        await prisma.user.count({
          where: {
            email: sharedEmail,
          },
        })

        await waitForSpanTree(
          operation('User', 'count', [
            ...clientCompile('aggregate', 'User'),
            clientSerialize(),
            ...engine([
              isMongoDb
                ? dbQuery(expect.stringContaining('db.User.aggregate'))
                : dbQuery(expect.stringContaining('SELECT COUNT')),
            ]),
          ]),
        )
      })

      test('aggregate', async () => {
        await prisma.user.aggregate({
          where: {
            email: sharedEmail,
          },
          _max: {
            id: true,
          },
        })

        await waitForSpanTree(
          operation('User', 'aggregate', [
            ...clientCompile('aggregate', 'User'),
            clientSerialize(),
            ...engine([
              isMongoDb
                ? dbQuery(expect.stringContaining('db.User.aggregate'))
                : dbQuery(expect.stringContaining('SELECT MAX')),
            ]),
          ]),
        )
      })
    })

    describe('tracing on transactions', () => {
      test('$transaction', async () => {
        const email = faker.internet.email()

        await prisma.$transaction([
          prisma.user.create({
            data: {
              email,
            },
          }),
          prisma.user.findMany({
            where: {
              email,
            },
          }),
        ])

        let expectedDbQueries: Tree[]

        if (isMongoDb) {
          expectedDbQueries = [...createDbQueries(false), findManyDbQuery()]
        } else {
          expectedDbQueries = [...createDbQueries(false), findManyDbQuery()]
          expectedDbQueries.push(itxOperation('start'))
          expectedDbQueries.unshift(itxOperation('commit'))
          if (!usesJsDrivers) {
            // Driver adapters do not issue BEGIN through the query engine.
            expectedDbQueries.unshift(txBegin())
          }
          if (isSqlServer && !usesJsDrivers) {
            expectedDbQueries.unshift(txSetIsolationLevel())
          }
        }

        await waitForSpanTree({
          name: 'prisma:client:transaction',
          attributes: {
            method: '$transaction',
          },
          children: [
            operation('User', 'create', [
              ...clientCompileBatch(['createOne', 'findMany'], ['User', 'User']),
              clientSerialize(),
              ...engine([...expectedDbQueries]),
            ]),
            operation('User', 'findMany', [clientSerialize()]),
          ],
        })
      })

      test('interactive transaction commit', async () => {
        const email = faker.internet.email()

        await prisma.$transaction(async (client) => {
          await client.user.create({
            data: {
              email,
            },
          })
          await client.user.findMany({
            where: {
              email,
            },
          })
        })

        await waitForSpanTree({
          name: 'prisma:client:transaction',
          attributes: {
            method: '$transaction',
          },
          children: [
            operation('User', 'create', [
              ...clientCompile('createOne', 'User'),
              clientSerialize(),
              ...engine([...createDbQueries(false)]),
            ]),
            operation('User', 'findMany', [
              ...clientCompile('findMany', 'User'),
              clientSerialize(),
              ...engine([findManyDbQuery()]),
            ]),
            itxOperation('commit'),
            itxOperation('start'),
          ],
        })
      })

      test('interactive transaction rollback', async () => {
        const email = faker.internet.email()

        await prisma
          .$transaction(async (client) => {
            await client.user.create({
              data: {
                email,
              },
            })
            await client.user.findMany({
              where: {
                email,
              },
            })
            throw new Error('rollback')
          })
          .catch(() => {})

        await waitForSpanTree({
          name: 'prisma:client:transaction',
          attributes: {
            method: '$transaction',
          },
          children: [
            operation('User', 'create', [
              ...clientCompile('createOne', 'User'),
              clientSerialize(),
              ...engine([...createDbQueries(false)]),
            ]),
            operation('User', 'findMany', [
              ...clientCompile('findMany', 'User'),
              clientSerialize(),
              ...engine([findManyDbQuery()]),
            ]),
            itxOperation('rollback'),
            itxOperation('start'),
          ],
        })
      })
    })

    describeIf(provider !== Providers.MONGODB)('tracing on $raw methods', () => {
      test('$queryRaw', async () => {
        // @ts-test-if: provider !== Providers.MONGODB
        await prisma.$queryRaw`SELECT 1 + 1;`
        await waitForSpanTree(
          operation(undefined, 'queryRaw', [clientSerialize(), ...engine([dbQuery('SELECT 1 + 1;')])]),
        )
      })

      test('$executeRaw', async () => {
        // Raw query failed. Code: `N/A`. Message: `Execute returned results, which is not allowed in SQLite.`
        if (provider === Providers.SQLITE || isMongoDb) {
          return
        }

        // @ts-test-if: provider !== Providers.MONGODB
        await prisma.$executeRaw`SELECT 1 + 1;`

        await waitForSpanTree(
          operation(undefined, 'executeRaw', [clientSerialize(), ...engine([dbQuery('SELECT 1 + 1;')])]),
        )
      })
    })

    test('tracing with custom span', async () => {
      const tracer = trace.getTracer('MyApp')
      const email = faker.internet.email()

      await tracer.startActiveSpan('create-user', async (span) => {
        try {
          return await prisma.user.create({
            data: {
              email: email,
            },
          })
        } finally {
          span.end()
        }
      })

      await waitForSpanTree({
        name: 'create-user',
        children: [
          operation('User', 'create', [
            ...clientCompile('createOne', 'User'),
            clientSerialize(),
            ...engine([...createDbQueries()]),
          ]),
        ],
      })
    })

    // $connect is a no-op with Data Proxy
    describeIf(!clientMeta.dataProxy)('tracing connect', () => {
      let _prisma: PrismaClient

      beforeEach(() => {
        _prisma = newPrismaClient({})
      })

      afterEach(async () => {
        await _prisma.$disconnect()
      })

      test('should trace the implicit $connect call', async () => {
        const email = faker.internet.email()

        await _prisma.user.findMany({
          where: {
            email: email,
          },
        })

        await waitForSpanTree([
          operation('User', 'findMany', [
            ...clientCompile('findMany', 'User'),
            {
              name: 'prisma:client:connect',
              children: engineConnect(),
            },
            clientSerialize(),
            ...engine([findManyDbQuery()]),
          ]),
        ])
      })

      test('should trace the explicit $connect call', async () => {
        await _prisma.$connect()

        await waitForSpanTree([
          {
            name: 'prisma:client:connect',
            children: engineConnect(),
          },
        ])
      })
    })

    // $disconnect is a no-op with Data Proxy
    describeIf(!clientMeta.dataProxy)('tracing disconnect', () => {
      let _prisma: PrismaClient

      beforeAll(async () => {
        _prisma = newPrismaClient({})
        await _prisma.$connect()
      })

      test('should trace $disconnect', async () => {
        await _prisma.$disconnect()

        await waitForSpanTree({
          name: 'prisma:client:disconnect',
          children: undefined,
        })
      })
    })
  },
  {
    skipDriverAdapter: {
      from: [AdapterProviders.JS_D1],
      reason:
        'js_d1: Errors with D1_ERROR: A prepared SQL statement must contain only one statement. See https://github.com/prisma/team-orm/issues/880  https://github.com/cloudflare/workers-sdk/issues/3892#issuecomment-1912102659',
    },
  },
)

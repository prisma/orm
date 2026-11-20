import { faker } from '@faker-js/faker'
import { context, SpanContext, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { PrismaInstrumentation } from '@prisma/instrumentation'

import { AdapterProviders, Providers } from '../_utils/providers'
import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

// @only-ts-generator
type LogPrismaClient = PrismaClient<'query'>
// @only-js-generator
type LogPrismaClient = PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }>

declare const newPrismaClient: NewPrismaClient<LogPrismaClient, typeof PrismaClient>

let inMemorySpanExporter: InMemorySpanExporter
let processor: SpanProcessor

beforeAll(() => {
  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)

  inMemorySpanExporter = new InMemorySpanExporter()
  processor = new SimpleSpanProcessor(inMemorySpanExporter)

  const basicTracerProvider = new BasicTracerProvider({
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

testMatrix.setupTestSuite(
  ({ provider, driverAdapter }) => {
    const isMongoDb = provider === Providers.MONGODB

    let client: LogPrismaClient

    beforeEach(() => {
      inMemorySpanExporter.reset()
      client = newPrismaClient({
        log: [{ emit: 'event', level: 'query' }],
      })
    })

    afterEach(async () => {
      // The client is undefined if the suite failed before `beforeEach` completed.
      await client?.$disconnect()
    })

    /**
     * Records the span that was active when each `query` event was emitted.
     * `undefined` entries mark events emitted outside of any span.
     */
    function recordActiveSpans(): (SpanContext | undefined)[] {
      const spanContexts: (SpanContext | undefined)[] = []

      client.$on('query', () => {
        spanContexts.push(trace.getActiveSpan()?.spanContext())
      })

      return spanContexts
    }

    /**
     * Resolves each recorded span context against the exported spans and
     * asserts that every event was emitted inside its own `db_query` span.
     */
    async function expectAllEventsInDbQuerySpans(spanContexts: (SpanContext | undefined)[]): Promise<void> {
      await processor.forceFlush()

      const finishedSpans = inMemorySpanExporter.getFinishedSpans()

      const spanNames = spanContexts.map(
        (spanContext) =>
          finishedSpans.find(
            (span) =>
              span.spanContext().traceId === spanContext?.traceId && span.spanContext().spanId === spanContext?.spanId,
          )?.name,
      )

      expect(spanNames.length).toBeGreaterThan(0)

      for (const name of spanNames) {
        expect(name).toMatch(/db_query$/)
      }
    }

    test('query events are emitted within the span of the query they describe', async () => {
      const spanContexts = recordActiveSpans()

      await client.user.findMany()

      await expectAllEventsInDbQuerySpans(spanContexts)
    })

    test('query events are emitted within the span of the query they describe in a batch transaction', async () => {
      const spanContexts = recordActiveSpans()

      const id = isMongoDb ? faker.database.mongodbObjectId() : faker.string.uuid()

      await client.$transaction([client.user.findMany({ where: { id } })])

      await expectAllEventsInDbQuerySpans(spanContexts)
    })

    // D1: interactive transactions are not available
    skipTestIf(driverAdapter === AdapterProviders.JS_D1)(
      'query events are emitted within the span of the query they describe in an interactive transaction',
      async () => {
        const spanContexts = recordActiveSpans()

        const email = faker.internet.email()

        await client.$transaction(async (tx) => {
          await tx.user.create({ data: { email } })
          return tx.user.findMany({ where: { email } })
        })

        await expectAllEventsInDbQuerySpans(spanContexts)
      },
    )

    test('all query events within a single operation share the same trace', async () => {
      const spanContexts = recordActiveSpans()

      // A nested write always spans several queries. A read with `include`
      // would collapse into a single query under the `relationJoins` preview
      // feature, leaving nothing to correlate.
      await client.user.create({
        data: {
          email: faker.internet.email(),
          posts: {
            create: [{ title: 'Post 1' }, { title: 'Post 2' }],
          },
        },
      })

      expect(spanContexts.length).toBeGreaterThan(1)
      await expectAllEventsInDbQuerySpans(spanContexts)

      expect(new Set(spanContexts.map((spanContext) => spanContext!.traceId)).size).toBe(1)
    })
  },
  {
    skipDefaultClientInstance: true,
  },
)

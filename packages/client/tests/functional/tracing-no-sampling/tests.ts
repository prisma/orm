import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { PrismaInstrumentation } from '@prisma/instrumentation'
import { traceContext } from '@prisma/sqlcommenter-trace-context'

import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './generated/prisma/client'

let prisma: PrismaClient
declare const newPrismaClient: NewPrismaClient<PrismaClient, typeof PrismaClient>

let inMemorySpanExporter: InMemorySpanExporter

beforeAll(() => {
  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)

  inMemorySpanExporter = new InMemorySpanExporter()

  const basicTracerProvider = new BasicTracerProvider({
    sampler: new TraceIdRatioBasedSampler(0), // 0% sampling!!
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'test-name',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    spanProcessors: [new SimpleSpanProcessor(inMemorySpanExporter)],
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
  () => {
    const queries: string[] = []

    function checkQueriesHaveNotTraceparent() {
      const result = !queries.some((q) => q.includes('traceparent'))

      queries.length = 0

      return result
    }

    beforeAll(() => {
      prisma = newPrismaClient({
        log: [{ emit: 'event', level: 'query' }],
        comments: [traceContext()],
      })

      // @ts-expect-error - client not typed for log opts for cross generator compatibility - can be improved once we drop the prisma-client-js generator
      prisma.$on('query', (e) => queries.push(e.query))
    })

    // https://github.com/prisma/prisma/issues/19088
    test('should perform a query and assert that no spans were generated', async () => {
      await prisma.user.findMany()

      const spans = inMemorySpanExporter.getFinishedSpans()

      expect(spans).toHaveLength(0)
      expect(checkQueriesHaveNotTraceparent()).toBe(true)
    })

    // https://github.com/prisma/prisma/issues/19088
    test('should perform a query and assert that no spans were generated via itx', async () => {
      await prisma.$transaction(async (prisma) => {
        await prisma.user.findMany()
      })

      const spans = inMemorySpanExporter.getFinishedSpans()

      expect(spans).toHaveLength(0)
      expect(checkQueriesHaveNotTraceparent()).toBe(true)
    })
  },
  {
    skipDefaultClientInstance: true,
    skipDriverAdapter: {
      from: ['js_d1'],
      reason: 'D1 does not support interactive transactions',
    },
  },
)

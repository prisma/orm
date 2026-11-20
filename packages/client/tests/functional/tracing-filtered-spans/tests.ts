import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { PrismaInstrumentation } from '@prisma/instrumentation'

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
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'test-name',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    spanProcessors: [new SimpleSpanProcessor(inMemorySpanExporter)],
  })

  trace.setGlobalTracerProvider(basicTracerProvider)

  registerInstrumentations({
    instrumentations: [
      new PrismaInstrumentation({
        ignoreSpanTypes: [
          /prisma:client:operat.*/,
          'prisma:client:compile',
          'prisma:client:db_query',
          'prisma:accelerate:db_query',
        ],
      }),
    ],
  })
})

afterAll(() => {
  context.disable()
})

testMatrix.setupTestSuite(
  ({ engineType }) => {
    beforeAll(() => {
      inMemorySpanExporter.reset()
      prisma = newPrismaClient({ log: [{ emit: 'event', level: 'query' }] })
    })

    test('should filter out spans and their children based on name', async () => {
      await prisma.$connect()
      await prisma.user.findMany()

      const spans = inMemorySpanExporter.getFinishedSpans()

      const expectedSpans = ['prisma:client:connect', 'prisma:client:serialize']

      if (engineType === 'client') {
        expectedSpans.splice(0, 3) // Client engine performs no binary engine related spans
      }

      expect(spans.map((span) => span.name)).toEqual(expectedSpans)
    })
  },
  {
    skipDefaultClientInstance: true,
  },
)

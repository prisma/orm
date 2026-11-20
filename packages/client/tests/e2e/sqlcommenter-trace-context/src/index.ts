import assert from 'node:assert/strict'

import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaInstrumentation, registerInstrumentations } from '@prisma/instrumentation'
import { traceContext } from '@prisma/sqlcommenter-trace-context'

import { PrismaClient } from './generated/prisma/client.js'

// Test 1: Tracing enabled with 100% sampling - traceparent should be present
console.log('Test 1: Tracing enabled with 100% sampling')
{
  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)

  const spanExporter = new InMemorySpanExporter()
  const tracerProvider = new BasicTracerProvider({
    sampler: new TraceIdRatioBasedSampler(1), // 100% sampling
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'sqlcommenter-trace-context-test',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  })

  trace.setGlobalTracerProvider(tracerProvider)

  const prismaInstrumentation = new PrismaInstrumentation()
  registerInstrumentations({
    instrumentations: [prismaInstrumentation],
  })

  const adapter = new PrismaBetterSqlite3({ url: './dev.db' })
  const capturedQueries: string[] = []

  const prisma = new PrismaClient({
    adapter,
    comments: [traceContext()],
    log: [{ emit: 'event', level: 'query' }],
  })

  prisma.$on('query', (event) => {
    capturedQueries.push(event.query)
  })

  // Run a query within a traced span
  const tracer = tracerProvider.getTracer('test')
  await tracer.startActiveSpan('test-operation', async (span) => {
    await prisma.user.findMany()
    span.end()
  })

  await prisma.$disconnect()

  // Verify traceparent is present in the query
  assert.equal(capturedQueries.length, 1, 'Expected 1 query')
  const query = capturedQueries[0]
  assert.match(
    query,
    /\/\*traceparent='00-[a-f0-9]{32}-[a-f0-9]{16}-01'\*\/$/,
    `Query should contain traceparent comment with sampled flag (01): ${query}`,
  )

  console.log('  ✓ traceparent comment present with sampled flag')

  // Cleanup
  prismaInstrumentation.disable()
  context.disable()
  trace.disable()
}

// Test 2: Tracing enabled with 0% sampling - traceparent should NOT be present
console.log('Test 2: Tracing enabled with 0% sampling')
{
  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)

  const spanExporter = new InMemorySpanExporter()
  const tracerProvider = new BasicTracerProvider({
    sampler: new TraceIdRatioBasedSampler(0), // 0% sampling
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'sqlcommenter-trace-context-test',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    }),
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  })

  trace.setGlobalTracerProvider(tracerProvider)

  const prismaInstrumentation = new PrismaInstrumentation()
  registerInstrumentations({
    instrumentations: [prismaInstrumentation],
  })

  const adapter = new PrismaBetterSqlite3({ url: './dev.db' })
  const capturedQueries: string[] = []

  const prisma = new PrismaClient({
    adapter,
    comments: [traceContext()],
    log: [{ emit: 'event', level: 'query' }],
  })

  prisma.$on('query', (event) => {
    capturedQueries.push(event.query)
  })

  await prisma.user.findMany()
  await prisma.$disconnect()

  // Verify traceparent is NOT present (since sampling is 0%)
  assert.equal(capturedQueries.length, 1, 'Expected 1 query')
  const query = capturedQueries[0]
  assert.ok(!query.includes('traceparent'), `Query should NOT contain traceparent comment when not sampled: ${query}`)

  console.log('  ✓ traceparent comment NOT present when not sampled')

  // Cleanup
  prismaInstrumentation.disable()
  context.disable()
  trace.disable()
}

// Test 3: No tracing configured - traceparent should NOT be present
console.log('Test 3: No tracing configured')
{
  const adapter = new PrismaBetterSqlite3({ url: './dev.db' })
  const capturedQueries: string[] = []

  const prisma = new PrismaClient({
    adapter,
    comments: [traceContext()],
    log: [{ emit: 'event', level: 'query' }],
  })

  prisma.$on('query', (event) => {
    capturedQueries.push(event.query)
  })

  await prisma.user.findMany()
  await prisma.$disconnect()

  // Verify traceparent is NOT present (since tracing is not configured)
  assert.equal(capturedQueries.length, 1, 'Expected 1 query')
  const query = capturedQueries[0]
  assert.ok(
    !query.includes('traceparent'),
    `Query should NOT contain traceparent comment when tracing is not configured: ${query}`,
  )

  console.log('  ✓ traceparent comment NOT present when tracing is not configured')
}

console.log('\n✅ SQL commenter tracecontext e2e test passed!')

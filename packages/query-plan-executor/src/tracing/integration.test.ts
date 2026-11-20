import timers from 'node:timers/promises'

import { context, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { expect, test } from 'vitest'

import { TracingCollector, tracingCollectorContext } from './collector'
import { TracingHandler } from './handler'
import { getTestTracerProvider } from './test-utils'

// Set up async context for tests
context.setGlobalContextManager(new AsyncLocalStorageContextManager())

test('full flow with nested spans and context', async () => {
  const exporter = new InMemorySpanExporter()

  await using tracerProvider = getTestTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })

  const tracer = tracerProvider.getTracer('test')

  const collector = TracingCollector.newInCurrentContext()
  const handler = new TracingHandler(tracer)

  // Function that will use the tracing system
  function processData(data: string): Promise<string> {
    return handler.runInChildSpan('process-data', async (span) => {
      span?.setAttribute('data.size', data.length)

      // Simulate parsing the data
      const parsed = await handler.runInChildSpan('parse-data', async () => {
        await timers.setTimeout(5) // Simulate work
        return { value: data.toUpperCase() }
      })

      // Simulate transforming the data
      const result = await handler.runInChildSpan('transform-data', async () => {
        await timers.setTimeout(5) // Simulate work
        return `Processed: ${parsed.value}`
      })

      return result
    })
  }

  const result = await tracingCollectorContext.withActive(collector, async () => {
    return await processData('test data')
  })

  // Verify the function result
  expect(result).toEqual('Processed: TEST DATA')

  // Verify spans were collected
  expect(collector.spans.length).toEqual(3)

  // Find each span by name
  const processSpan = collector.spans.find((s) => s.name === 'prisma:accelerate:process-data')
  const parseSpan = collector.spans.find((s) => s.name === 'prisma:accelerate:parse-data')
  const transformSpan = collector.spans.find((s) => s.name === 'prisma:accelerate:transform-data')

  // Verify all spans exist
  expect(processSpan).toBeDefined()
  expect(parseSpan).toBeDefined()
  expect(transformSpan).toBeDefined()

  // Verify attributes were set
  expect(processSpan?.attributes?.['data.size']).toEqual(9)

  // Verify parent-child relationships
  expect(parseSpan!.parentId).toEqual(processSpan!.id)
  expect(transformSpan!.parentId).toEqual(processSpan!.id)

  // Verify timing - process span should encompass the other spans
  const processStartTime = processSpan!.startTime[0] * 1_000_000_000 + processSpan!.startTime[1]
  const processEndTime = processSpan!.endTime[0] * 1_000_000_000 + processSpan!.endTime[1]

  const parseStartTime = parseSpan!.startTime[0] * 1_000_000_000 + parseSpan!.startTime[1]
  const parseEndTime = parseSpan!.endTime[0] * 1_000_000_000 + parseSpan!.endTime[1]

  const transformStartTime = transformSpan!.startTime[0] * 1_000_000_000 + transformSpan!.startTime[1]
  const transformEndTime = transformSpan!.endTime[0] * 1_000_000_000 + transformSpan!.endTime[1]

  // Process span should start before and end after both child spans
  expect(processStartTime).toBeLessThanOrEqual(parseStartTime)
  expect(processEndTime).toBeGreaterThanOrEqual(parseEndTime)
  expect(processStartTime).toBeLessThanOrEqual(transformStartTime)
  expect(processEndTime).toBeGreaterThanOrEqual(transformEndTime)

  // Parse span should happen before transform span
  expect(parseStartTime <= transformStartTime).toEqual(true)

  // ----- VERIFY OPENTELEMETRY SPANS -----

  await tracerProvider.forceFlush()

  // Get the finished spans from the exporter
  const exportedSpans = exporter.getFinishedSpans()

  // Verify spans were captured by the OpenTelemetry exporter
  expect(exportedSpans.length).toEqual(3)

  // Find each OTel span by name
  const otelProcessSpan = exportedSpans.find((s) => s.name === 'process-data')
  const otelParseSpan = exportedSpans.find((s) => s.name === 'parse-data')
  const otelTransformSpan = exportedSpans.find((s) => s.name === 'transform-data')

  // Verify all OTel spans exist
  expect(otelProcessSpan, 'Process span should exist in OTel exporter').toBeDefined()
  expect(otelParseSpan, 'Parse span should exist in OTel exporter').toBeDefined()
  expect(otelTransformSpan, 'Transform span should exist in OTel exporter').toBeDefined()

  // Verify attributes were set in OTel spans
  expect(otelProcessSpan!.attributes['data.size']).toEqual(9)

  // Get the span context for comparison
  const processContext = otelProcessSpan!.spanContext()
  const parseContext = otelParseSpan!.spanContext()
  const transformContext = otelTransformSpan!.spanContext()

  // Verify trace IDs are consistent across spans
  const traceId = processContext.traceId
  expect(parseContext.traceId).toEqual(traceId)
  expect(transformContext.traceId).toEqual(traceId)

  // Create a snapshot of the spans for future reference
  const spanSnapshot = exportedSpans.map((span) => {
    // Infer parent relationship based on span's position in the test
    // In our tests, the parse-data and transform-data spans have a parent, process-data doesn't
    const hasParent = span.name !== 'process-data'

    return {
      name: span.name,
      kind:
        span.kind === SpanKind.INTERNAL
          ? 'INTERNAL'
          : span.kind === SpanKind.CLIENT
            ? 'CLIENT'
            : span.kind === SpanKind.SERVER
              ? 'SERVER'
              : String(span.kind),
      attributes: Object.fromEntries(Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b))),
      status:
        span.status.code === SpanStatusCode.UNSET ? 'UNSET' : span.status.code === SpanStatusCode.OK ? 'OK' : 'ERROR',
      hasParent,
    }
  })

  // Sort the snapshot for consistent ordering
  spanSnapshot.sort((a, b) => a.name.localeCompare(b.name))

  // Verify the snapshot structure
  expect(spanSnapshot).toEqual([
    {
      name: 'parse-data',
      kind: 'INTERNAL',
      attributes: {},
      status: 'UNSET',
      hasParent: true,
    },
    {
      name: 'process-data',
      kind: 'INTERNAL',
      attributes: { 'data.size': 9 },
      status: 'UNSET',
      hasParent: false,
    },
    {
      name: 'transform-data',
      kind: 'INTERNAL',
      attributes: {},
      status: 'UNSET',
      hasParent: true,
    },
  ])
})

test('handles errors correctly', async () => {
  const exporter = new InMemorySpanExporter()

  await using tracerProvider = getTestTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })

  const tracer = tracerProvider.getTracer('test')

  const collector = TracingCollector.newInCurrentContext()
  const handler = new TracingHandler(tracer)

  // Function that will throw an error
  function processBrokenData(): Promise<string> {
    return handler.runInChildSpan('process-broken-data', async (_span) => {
      // First child operation succeeds
      await handler.runInChildSpan('first-step', async () => {
        await timers.setTimeout(5)
        return 'first step completed'
      })

      // Second child operation fails
      return await handler.runInChildSpan('error-step', async () => {
        await timers.setTimeout(5)
        throw new Error('Processing error')
      })
    })
  }

  // Run the function and catch the error
  let error: Error | undefined
  try {
    await tracingCollectorContext.withActive(collector, async () => {
      return await processBrokenData()
    })
  } catch (e) {
    error = e as Error
  }

  // Verify the error was thrown
  expect(error).toBeDefined()
  expect(error!.message).toEqual('Processing error')

  // Verify spans were collected, including for the failed operation
  expect(collector.spans.length).toEqual(3)

  // All spans should be recorded despite the error
  expect(collector.spans.find((s) => s.name === 'prisma:accelerate:process-broken-data')).toBeDefined()
  expect(collector.spans.find((s) => s.name === 'prisma:accelerate:first-step')).toBeDefined()
  expect(collector.spans.find((s) => s.name === 'prisma:accelerate:error-step')).toBeDefined()

  // ----- VERIFY OPENTELEMETRY SPANS -----

  await tracerProvider.forceFlush()

  // Get the finished spans from the exporter
  const exportedSpans = exporter.getFinishedSpans()

  // Verify spans were captured
  expect(exportedSpans.length).toEqual(3)

  // Find each OTel span by name
  const otelProcessSpan = exportedSpans.find((s) => s.name === 'process-broken-data')
  const otelFirstStepSpan = exportedSpans.find((s) => s.name === 'first-step')
  const otelErrorStepSpan = exportedSpans.find((s) => s.name === 'error-step')

  // Verify all OTel spans exist
  expect(otelProcessSpan, 'Process span should exist in OTel exporter').toBeDefined()
  expect(otelFirstStepSpan, 'First step span should exist in OTel exporter').toBeDefined()
  expect(otelErrorStepSpan, 'Error step span should exist in OTel exporter').toBeDefined()

  // Get the span contexts for comparison
  const processContext = otelProcessSpan!.spanContext()
  const firstStepContext = otelFirstStepSpan!.spanContext()
  const errorStepContext = otelErrorStepSpan!.spanContext()

  // Verify trace IDs are consistent
  const traceId = processContext.traceId
  expect(firstStepContext.traceId).toEqual(traceId)
  expect(errorStepContext.traceId).toEqual(traceId)

  // Create a snapshot of the spans for future reference
  const spanSnapshot = exportedSpans.map((span) => {
    // Infer parent relationship based on span's position in the test
    // In our tests, first-step and error-step have a parent, process-broken-data doesn't
    const hasParent = span.name !== 'process-broken-data'

    return {
      name: span.name,
      kind:
        span.kind === SpanKind.INTERNAL
          ? 'INTERNAL'
          : span.kind === SpanKind.CLIENT
            ? 'CLIENT'
            : span.kind === SpanKind.SERVER
              ? 'SERVER'
              : String(span.kind),
      attributes: Object.fromEntries(Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b))),
      status:
        span.status.code === SpanStatusCode.UNSET ? 'UNSET' : span.status.code === SpanStatusCode.OK ? 'OK' : 'ERROR',
      hasParent,
    }
  })

  // Sort the snapshot for consistent ordering
  spanSnapshot.sort((a, b) => a.name.localeCompare(b.name))

  // Verify the snapshot structure
  expect(spanSnapshot).toEqual([
    {
      name: 'error-step',
      kind: 'INTERNAL',
      attributes: {},
      status: 'UNSET', // Even with error, OpenTelemetry won't automatically set status
      hasParent: true,
    },
    {
      name: 'first-step',
      kind: 'INTERNAL',
      attributes: {},
      status: 'UNSET',
      hasParent: true,
    },
    {
      name: 'process-broken-data',
      kind: 'INTERNAL',
      attributes: {},
      status: 'UNSET',
      hasParent: false,
    },
  ])
})

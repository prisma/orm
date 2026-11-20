import timers from 'node:timers/promises'

import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { describe, expect, test } from 'vitest'

import { TracingCollector, tracingCollectorContext } from './collector'
import { TracingHandler } from './handler'
import { getTestTracer } from './test-utils'

// Set up async context for tests
context.setGlobalContextManager(new AsyncLocalStorageContextManager())

describe('TracingHandler', () => {
  test('runInChildSpan with string name', () => {
    const collector = TracingCollector.newInCurrentContext()
    const handler = new TracingHandler(getTestTracer())

    const result = tracingCollectorContext.withActive(collector, () => {
      return handler.runInChildSpan('test-operation', (span, ctx) => {
        expect(span).toBeDefined()
        expect(ctx).toBeDefined()

        // Return a test value to verify that it's passed through
        return 'test-result'
      })
    })

    // Verify the result
    expect(result).toEqual('test-result')

    // Verify a span was collected
    expect(collector.spans.length).toEqual(1)
    expect(collector.spans[0].name).toEqual('prisma:accelerate:test-operation')
  })

  test('runInChildSpan with options object', () => {
    const collector = TracingCollector.newInCurrentContext()
    const handler = new TracingHandler(getTestTracer())

    const result = tracingCollectorContext.withActive(collector, () => {
      return handler.runInChildSpan(
        {
          name: 'test-operation',
          attributes: { 'test.key': 'test.value' },
        },
        (span) => {
          // Set additional attributes on the span
          span?.setAttribute('another.key', 'another.value')

          return 'test-result'
        },
      )
    })

    // Verify the result
    expect(result).toEqual('test-result')

    // Verify a span was collected with the expected attributes
    expect(collector.spans.length).toEqual(1)
    const collectedSpan = collector.spans[0]
    expect(collectedSpan.name).toEqual('prisma:accelerate:test-operation')
    expect(collectedSpan.attributes).toBeDefined()
    expect(collectedSpan.attributes!['test.key']).toEqual('test.value')
    expect(collectedSpan.attributes!['another.key']).toEqual('another.value')
  })

  test('runInChildSpan with async function', async () => {
    const collector = TracingCollector.newInCurrentContext()
    const handler = new TracingHandler(getTestTracer())

    const result = await tracingCollectorContext.withActive(collector, () => {
      return handler.runInChildSpan('async-operation', async (_span) => {
        await timers.setTimeout(10) // Simulate async work
        return 'async-result'
      })
    })

    // Verify the result
    expect(result).toEqual('async-result')

    // Verify a span was collected
    expect(collector.spans.length).toEqual(1)
    expect(collector.spans[0].name).toEqual('prisma:accelerate:async-operation')
  })

  test('runs without active collector', () => {
    const handler = new TracingHandler(getTestTracer())

    // This should not throw, even though there's no collector
    const result = handler.runInChildSpan('test-operation', (_span) => {
      return 'test-result'
    })

    // Verify the function executed normally
    expect(result).toEqual('test-result')
  })

  test('handles errors in sync functions', () => {
    const collector = TracingCollector.newInCurrentContext()
    const handler = new TracingHandler(getTestTracer())

    let error: Error | undefined
    try {
      tracingCollectorContext.withActive(collector, () => {
        handler.runInChildSpan('error-operation', () => {
          throw new Error('Test error')
        })
      })
    } catch (e) {
      error = e as Error
    }

    // Verify the error was propagated
    expect(error).toBeDefined()
    expect(error!.message).toEqual('Test error')

    // Verify a span was collected despite the error
    expect(collector.spans.length).toEqual(1)
    expect(collector.spans[0].name).toEqual('prisma:accelerate:error-operation')
  })

  test('handles errors in async functions', async () => {
    const collector = TracingCollector.newInCurrentContext()
    const handler = new TracingHandler(getTestTracer())

    let error: Error | undefined
    try {
      await tracingCollectorContext.withActive(collector, () => {
        return handler.runInChildSpan('async-error-operation', async () => {
          await timers.setTimeout(10) // Simulate async work
          throw new Error('Async test error')
        })
      })
    } catch (e) {
      error = e as Error
    }

    // Verify the error was propagated
    expect(error).toBeDefined()
    expect(error!.message).toEqual('Async test error')

    // Verify a span was collected despite the error
    expect(collector.spans.length).toEqual(1)
    expect(collector.spans[0].name).toEqual('prisma:accelerate:async-error-operation')
  })

  test('nested spans create parent-child relationship', () => {
    const collector = TracingCollector.newInCurrentContext()
    const handler = new TracingHandler(getTestTracer())

    tracingCollectorContext.withActive(collector, () => {
      handler.runInChildSpan('parent-operation', (_parentSpan) => {
        // Run a child span inside the parent span
        handler.runInChildSpan('child-operation', (_childSpan) => {
          // Do some work in the child span
        })
      })
    })

    // Verify both spans were collected
    expect(collector.spans.length).toEqual(2)

    // Sort spans to ensure we have parent first, child second
    const spans = [...collector.spans].sort((a, b) => a.name.localeCompare(b.name))

    // Extract the span IDs
    // child-operation comes first alphabetically, parent-operation second
    const parentId = spans[1].id

    // Verify the child has the parent ID
    expect(spans[0].parentId).toEqual(parentId)
    expect(spans[0].name).toEqual('prisma:accelerate:child-operation')
    expect(spans[1].name).toEqual('prisma:accelerate:parent-operation')
  })

  test('root option creates spans without parent', () => {
    const collector = TracingCollector.newInCurrentContext()
    const handler = new TracingHandler(getTestTracer())

    tracingCollectorContext.withActive(collector, () => {
      // Create a normal span first
      handler.runInChildSpan('parent-operation', (_parentSpan) => {
        // Then create a root span that ignores the parent
        handler.runInChildSpan(
          {
            name: 'root-operation',
            root: true, // This makes it ignore any active parent span
          },
          (_rootSpan) => {
            // Do some work in the root span
          },
        )
      })
    })

    // Verify both spans were collected
    expect(collector.spans.length).toEqual(2)

    // Find the root span
    const rootSpan = collector.spans.find((span) => span.name === 'prisma:accelerate:root-operation')

    // Verify it has no parent
    expect(rootSpan).toBeDefined()
    expect(rootSpan!.parentId).toEqual(null)
  })

  test('outer spans internal to the server are sanitized', () => {
    const handler = new TracingHandler(getTestTracer())

    handler.runInChildSpan('internal-operation', () => {
      const collector = TracingCollector.newInCurrentContext()

      tracingCollectorContext.withActive(collector, () => {
        handler.runInChildSpan('root-operation', () => {})
      })

      expect(collector.spans.length).toEqual(1)

      const rootSpan = collector.spans.find((span) => span.name === 'prisma:accelerate:root-operation')

      expect(rootSpan).toBeDefined()
      expect(rootSpan!.parentId).toEqual(null)
    })
  })
})

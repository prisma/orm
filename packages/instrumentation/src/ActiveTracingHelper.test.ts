import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type { EngineSpan, EngineTraceEvent, HrTime } from '@prisma/instrumentation-contract'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { ActiveTracingHelper } from './ActiveTracingHelper'

const exporter = new InMemorySpanExporter()
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})

function engineSpan(span: Partial<EngineSpan> & Pick<EngineSpan, 'id'>): EngineSpan {
  return {
    parentId: null,
    name: 'prisma:engine:db_query',
    startTime: [1, 0],
    endTime: [2, 0],
    kind: 'internal',
    ...span,
  }
}

function traceEvent(spanId: string, event: Partial<EngineTraceEvent> = {}): EngineTraceEvent {
  return {
    spanId,
    level: 'query',
    timestamp: [1, 500] satisfies HrTime,
    attributes: { message: `message for ${spanId}` },
    ...event,
  }
}

function spanByName(spans: ReadableSpan[], name: string): ReadableSpan {
  const span = spans.find((s) => s.name === name)
  if (!span) {
    throw new Error(`No span named ${name} among [${spans.map((s) => s.name).join(', ')}]`)
  }
  return span
}

describe('ActiveTracingHelper', () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  })

  afterAll(() => {
    context.disable()
  })

  beforeEach(() => {
    exporter.reset()
  })

  describe('dispatchEngineSpans', () => {
    test('emits each event while its own span is the active one', () => {
      const helper = new ActiveTracingHelper({ tracerProvider, ignoreSpanTypes: [] })

      const activeSpanIds: (string | undefined)[] = []

      helper.dispatchEngineSpans(
        [
          engineSpan({ id: 'root', name: 'prisma:engine:query' }),
          engineSpan({ id: 'child-1', parentId: 'root', name: 'prisma:engine:db_query_1' }),
          engineSpan({ id: 'child-2', parentId: 'root', name: 'prisma:engine:db_query_2' }),
        ],
        [traceEvent('child-1'), traceEvent('child-2')],
        () => {
          activeSpanIds.push(trace.getActiveSpan()?.spanContext().spanId)
        },
      )

      const spans = exporter.getFinishedSpans()
      const namesOfActiveSpans = activeSpanIds.map((id) => spans.find((s) => s.spanContext().spanId === id)?.name)

      expect(namesOfActiveSpans).toEqual(['prisma:engine:db_query_1', 'prisma:engine:db_query_2'])
    })

    test('records the events on the span they belong to', () => {
      const helper = new ActiveTracingHelper({ tracerProvider, ignoreSpanTypes: [] })

      helper.dispatchEngineSpans(
        [engineSpan({ id: 'root', name: 'prisma:engine:query' }), engineSpan({ id: 'child', parentId: 'root' })],
        [traceEvent('child')],
        () => {},
      )

      const spans = exporter.getFinishedSpans()

      expect(spanByName(spans, 'prisma:engine:query').events).toEqual([])
      expect(spanByName(spans, 'prisma:engine:db_query').events).toMatchObject([
        { name: 'query', attributes: { message: 'message for child' }, time: [1, 500] },
      ])
    })

    test('records error events as exceptions', () => {
      const helper = new ActiveTracingHelper({ tracerProvider, ignoreSpanTypes: [] })

      helper.dispatchEngineSpans(
        [engineSpan({ id: 'root' })],
        [traceEvent('root', { level: 'error', attributes: { message: 'boom' } })],
        () => {},
      )

      const [span] = exporter.getFinishedSpans()

      expect(span.events).toMatchObject([
        { name: 'error' },
        { name: 'exception', attributes: { 'exception.message': 'boom' } },
      ])
    })

    test('still emits events whose span was ignored', () => {
      const helper = new ActiveTracingHelper({
        tracerProvider,
        ignoreSpanTypes: ['prisma:engine:db_query'],
      })

      const emitted: EngineTraceEvent[] = []

      helper.dispatchEngineSpans(
        [engineSpan({ id: 'root', name: 'prisma:engine:query' }), engineSpan({ id: 'child', parentId: 'root' })],
        [traceEvent('child')],
        (event) => emitted.push(event),
      )

      expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual(['prisma:engine:query'])
      expect(emitted).toEqual([traceEvent('child')])
    })

    test('still emits events with no matching span at all', () => {
      const helper = new ActiveTracingHelper({ tracerProvider, ignoreSpanTypes: [] })

      const emitted: EngineTraceEvent[] = []

      helper.dispatchEngineSpans([engineSpan({ id: 'root' })], [traceEvent('unknown')], (event) => emitted.push(event))

      expect(emitted).toEqual([traceEvent('unknown')])
    })

    test('ends started spans when a log listener throws', () => {
      const helper = new ActiveTracingHelper({ tracerProvider, ignoreSpanTypes: [] })

      expect(() =>
        helper.dispatchEngineSpans(
          [engineSpan({ id: 'root', name: 'prisma:engine:query' }), engineSpan({ id: 'child', parentId: 'root' })],
          [traceEvent('child')],
          () => {
            throw new Error('listener blew up')
          },
        ),
      ).toThrow('listener blew up')

      // Both spans were started before the listener threw, so both must have
      // been ended and exported rather than leaked.
      expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual(['prisma:engine:db_query', 'prisma:engine:query'])
    })
  })
})

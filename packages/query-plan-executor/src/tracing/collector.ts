import { context, trace } from '@opentelemetry/api'

import { ExportableSpanId, parseSpanId, parseTraceId } from './id'
import { ExportableSpan } from './span'

/**
 * Collects spans in the scope of a request for sending the back to the Prisma Client.
 */
export class TracingCollector {
  readonly #rootFromSpanId: ExportableSpanId | null
  readonly spans: ExportableSpan[] = []

  /**
   * Creates a new instance of TracingCollector.
   *
   * @param rootFromSpanId - Defines the scope in which parent spans will be
   * sanitized. Every span which is a direct child of `rootFromSpanId` will be
   * marked as a root span instead. This ensures we don't reference internal
   * HTTP server spans we never send back to the Prisma Client, so it won't wait
   * for them.
   */
  constructor(rootFromSpanId: ExportableSpanId | null) {
    this.#rootFromSpanId = rootFromSpanId
  }

  /**
   * Creates a new instance of TracingCollector in the current context,
   * collecting all children of the currently active span as roots.
   */
  static newInCurrentContext(): TracingCollector {
    const parentSpan = trace.getActiveSpan()?.spanContext()
    let parentSpanId: ExportableSpanId | null = null

    if (parentSpan) {
      const traceId = parseTraceId(parentSpan.traceId)
      const spanId = parseSpanId(parentSpan.spanId)
      parentSpanId = `${traceId}-${spanId}`
    }

    return new TracingCollector(parentSpanId)
  }

  collectSpan(span: ExportableSpan): void {
    this.spans.push({
      ...span,
      parentId: span.parentId === this.#rootFromSpanId ? null : span.parentId,
    })
  }
}

const TRACING_COLLECTOR_KEY = Symbol('TracingCollector')

export const tracingCollectorContext = {
  getActive(): TracingCollector | undefined {
    const collector = context.active().getValue(TRACING_COLLECTOR_KEY)

    if (collector === undefined) {
      return undefined
    }

    if (collector instanceof TracingCollector) {
      return collector
    }

    throw new Error('Active tracing collector is not an instance of TracingCollector')
  },

  withActive<T>(collector: TracingCollector, fn: () => T): T {
    return context.with(context.active().setValue(TRACING_COLLECTOR_KEY, collector), fn)
  },
}

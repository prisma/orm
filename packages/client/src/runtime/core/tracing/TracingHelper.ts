import type { Context } from '@opentelemetry/api'
import {
  type EngineSpan,
  type EngineTraceEvent,
  type ExtendedSpanOptions,
  getGlobalTracingHelper,
  type SpanCallback,
  type TracingHelper,
} from '@prisma/instrumentation-contract'

export const disabledTracingHelper: TracingHelper = {
  isEnabled() {
    return false
  },
  getTraceParent() {
    // https://www.w3.org/TR/trace-context/#examples-of-http-traceparent-headers
    // If traceparent ends with -00 this trace will not be sampled
    // the query engine needs the `10` for the span and trace id otherwise it does not parse this
    return `00-10-10-00`
  },

  // Without tracing there are no spans to emit the events in the context of,
  // but the events themselves must still reach the log emitter: logging is
  // configured independently of tracing, and tracing can be disabled in the
  // middle of a request that already asked the server for spans.
  dispatchEngineSpans(
    _spans: EngineSpan[],
    events: EngineTraceEvent[],
    emitLogEvent: (event: EngineTraceEvent) => void,
  ) {
    for (const event of events) {
      emitLogEvent(event)
    }
  },

  getActiveContext() {
    return undefined
  },

  runInChildSpan<R>(options: string | ExtendedSpanOptions, callback: SpanCallback<R>): R {
    return callback()
  },
}

/**
 * Tracing helper that can dynamically switch between enabled/disabled states
 * Needed because tracing can be disabled and enabled with the calls to
 * PrismaInstrumentation::disable/enable at any point
 */
class DynamicTracingHelper implements TracingHelper {
  isEnabled(): boolean {
    return this.getTracingHelper().isEnabled()
  }
  getTraceParent(context: Context) {
    return this.getTracingHelper().getTraceParent(context)
  }

  dispatchEngineSpans(
    spans: EngineSpan[],
    events: EngineTraceEvent[],
    emitLogEvent: (event: EngineTraceEvent) => void,
  ) {
    return this.getTracingHelper().dispatchEngineSpans(spans, events, emitLogEvent)
  }

  getActiveContext() {
    return this.getTracingHelper().getActiveContext()
  }
  runInChildSpan<R>(options: string | ExtendedSpanOptions, callback: SpanCallback<R>): R {
    return this.getTracingHelper().runInChildSpan(options, callback)
  }

  private getTracingHelper(): TracingHelper {
    return getGlobalTracingHelper() ?? disabledTracingHelper
  }
}

export function getTracingHelper(): TracingHelper {
  return new DynamicTracingHelper()
}

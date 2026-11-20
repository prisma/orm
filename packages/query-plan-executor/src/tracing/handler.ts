import { Context, context, Span, trace, Tracer } from '@opentelemetry/api'
import { TracingHelper } from '@prisma/client-engine-runtime'
import { Temporal } from 'temporal-polyfill'

import { TracingCollector, tracingCollectorContext } from './collector'
import { ExtendedSpanOptions, normalizeSpanOptions } from './options'
import { SpanProxy } from './span'

/**
 * An implementation of {@link TracingHelper} from `@prisma/client-engine-runtime`
 * that both hooks into into the real OpenTelemetry instrumentation and, if there
 * is an active {@link TracingCollector}, converts the spans into the format
 * expected by the client and sends them to the collector.
 */
export class TracingHandler implements TracingHelper {
  readonly #tracer: Tracer

  constructor(tracer: Tracer) {
    this.#tracer = tracer
  }

  isEnabled(): boolean {
    return true
  }

  runInChildSpan<R>(nameOrOptions: string | ExtendedSpanOptions, callback: (span?: Span, context?: Context) => R): R {
    const options = normalizeSpanOptions(nameOrOptions)
    return new SpanScope(options, this.#tracer).run(callback)
  }
}

class SpanScope {
  readonly #options: ExtendedSpanOptions
  readonly #parentSpan: Span | undefined
  readonly #context: Context
  readonly #startTime: Temporal.Instant
  readonly #collector: TracingCollector | undefined
  readonly #tracer: Tracer

  constructor(options: ExtendedSpanOptions, tracer: Tracer) {
    this.#startTime = Temporal.Now.instant()
    this.#options = options
    this.#parentSpan = options.root ? undefined : trace.getActiveSpan()
    this.#context = context.active()
    this.#collector = tracingCollectorContext.getActive()
    this.#tracer = tracer
  }

  run<R>(callback: (span?: Span, context?: Context) => R): R {
    return this.#tracer.startActiveSpan(this.#options.name, this.#options, (span) => {
      const spanProxy = new SpanProxy({
        span,
        parentSpan: this.#parentSpan,
        spanOptions: this.#options,
        trueStartTime: this.#startTime,
      })
      try {
        return this.#endSpan(spanProxy, callback(spanProxy, this.#context))
      } catch (error) {
        this.#finalizeSpan(spanProxy)
        throw error
      }
    })
  }

  #endSpan<T>(span: SpanProxy, result: T): T {
    if (isPromiseLike(result)) {
      return this.#endAsyncSpan(span, result) as T
    }
    this.#finalizeSpan(span)
    return result
  }

  #endAsyncSpan(span: SpanProxy, result: PromiseLike<unknown>): PromiseLike<unknown> {
    return result.then(
      (value) => {
        this.#finalizeSpan(span)
        return value
      },
      (reason) => {
        this.#finalizeSpan(span)
        throw reason
      },
    )
  }

  #finalizeSpan(span: SpanProxy): void {
    const endTime = Temporal.Now.instant()
    const exportedSpan = span.endAndExport(endTime)
    this.#collector?.collectSpan(exportedSpan)
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as Record<PropertyKey, unknown>)['then'] === 'function'
}

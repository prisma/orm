import type { Context, Span, SpanOptions } from '@opentelemetry/api'

export type SpanCallback<R> = (span?: Span, context?: Context) => R

export interface ExtendedSpanOptions extends SpanOptions {
  /** The name of the span */
  name: string
  /* Internal spans are not shown unless PRISMA_SHOW_ALL_TRACES=true env var is set */
  internal?: boolean
  /** Whether it propagates context (?=true) */
  active?: boolean
  /** The context to append the span to */
  context?: Context
}

export type EngineSpanId = string

export type HrTime = [number, number]

export type EngineSpanKind = 'client' | 'internal'

export type EngineSpan = {
  id: EngineSpanId
  parentId: string | null
  name: string
  startTime: HrTime
  endTime: HrTime
  kind: EngineSpanKind
  attributes?: Record<string, unknown>
  links?: EngineSpanId[]
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'query'

export interface EngineTraceEvent {
  spanId: EngineSpanId
  target?: string
  level: LogLevel
  timestamp: HrTime
  attributes: Record<string, unknown> & {
    message?: string
    query?: string
    duration_ms?: number
    params?: string
  }
}

export interface EngineTrace {
  spans: EngineSpan[]
  events: EngineTraceEvent[]
}

export interface TracingHelper {
  isEnabled(): boolean
  getTraceParent(context?: Context): string

  /**
   * Emits spans reported by a remote engine, together with the log events that
   * were recorded while those spans were open.
   *
   * Implementations must call `emitLogEvent` exactly once for every entry in
   * `events`, otherwise the client silently drops logs the user asked for. Each
   * event should be emitted while the span identified by its `spanId` is the
   * active one, so that handlers registered via `$on` observe the same context
   * they would for a locally executed query. Events whose span is missing or
   * not emitted must still be passed to `emitLogEvent`.
   */
  dispatchEngineSpans(
    spans: EngineSpan[],
    events: EngineTraceEvent[],
    emitLogEvent: (event: EngineTraceEvent) => void,
  ): void

  getActiveContext(): Context | undefined

  runInChildSpan<R>(nameOrOptions: string | ExtendedSpanOptions, callback: SpanCallback<R>): R
}

export interface PrismaInstrumentationGlobalValue {
  helper?: TracingHelper
}

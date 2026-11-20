/**
 * OpenTelemetry trace ID.
 *
 * `@opentelemetry/api` uses plain `string` as a type and documents the
 * additional requirements, we can have a better type.
 */
export type TraceId = string & { length: 32 }

export const NULL_TRACE_ID = '00000000000000000000000000000000' as TraceId

/**
 * Validate and parse a trace ID.
 * @throws {Error} if the trace ID is invalid.
 */
export function parseTraceId(traceId: string): TraceId {
  if (traceId.length !== 32) {
    throw new Error(`Invalid trace ID: ${traceId}`)
  }
  return traceId as TraceId
}

/**
 * OpenTelemetry span ID.
 *
 * `@opentelemetry/api` uses plain `string` as a type and documents the
 * additional requirements, we can have a better type.
 */
export type SpanId = string & { length: 16 }

export const NULL_SPAN_ID = '0000000000000000' as SpanId

/**
 * Validate and parse a span ID.
 * @throws {Error} if the span ID is invalid.
 */
export function parseSpanId(spanId: string): SpanId {
  if (spanId.length !== 16) {
    throw new Error(`Invalid span ID: ${spanId}`)
  }
  return spanId as SpanId
}

/**
 * Span ID to be used in the logs and traces exported to Prisma Client.
 *
 * Prisma Client doesn't particularly care about the format and content of the
 * span ID, as it is only used for the purposes of re-creating the span
 * hierarchy, with brand new trace and span IDs assigned by the local tracer
 * provider on the client. Moreover, Query Engine doesn't even have a concept of
 * a trace ID, as it's using Tokio `tracing` and not OpenTelemetry internally.
 *
 * We use dash-separated OpenTelemetry trace ID and span ID to construct a
 * single unique identifier for each span. To avoid accidentally assigning
 * OpenTelemetry span IDs to `spanId` properties, we encode this on the type level.
 */
export type ExportableSpanId = `${TraceId}-${SpanId}`

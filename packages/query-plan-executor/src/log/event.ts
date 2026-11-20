import { Attributes, AttributeValue, HrTime, trace } from '@opentelemetry/api'
import { Temporal } from 'temporal-polyfill'

import { instantToHrTime } from '../formats/hr-time'
import {
  ExportableSpanId,
  NULL_SPAN_ID,
  NULL_TRACE_ID,
  parseSpanId,
  parseTraceId,
  SpanId,
  TraceId,
} from '../tracing/id'
import { LogLevel } from './log-level'

/**
 * Log event in a format expected by the Prisma Client.
 */
export type ExportableLogEvent = {
  level: LogLevel
  spanId: ExportableSpanId
  timestamp: HrTime
  message: string
  attributes: Attributes
}

/**
 * Extension of the {@link Attributes} type to allow recording errors.
 */
export type ExtendedAttributes = {
  [key: string]: AttributeValue | Error | undefined
}

/**
 * Internal representation of a log event.
 */
export class LogEvent {
  readonly level: LogLevel
  readonly traceId: TraceId
  readonly spanId: SpanId
  readonly timestamp: Temporal.Instant
  readonly message: string
  readonly attributes: ExtendedAttributes

  constructor(
    level: LogLevel,
    message: string,
    attributes: ExtendedAttributes = {},
    timestamp: Temporal.Instant = Temporal.Now.instant(),
  ) {
    const spanContext = trace.getActiveSpan()?.spanContext()

    if (spanContext !== undefined) {
      this.traceId = parseTraceId(spanContext.traceId)
      this.spanId = parseSpanId(spanContext.spanId)
    } else {
      this.traceId = NULL_TRACE_ID
      this.spanId = NULL_SPAN_ID
    }

    this.level = level
    this.timestamp = timestamp
    this.message = message
    this.attributes = attributes
  }

  export(): ExportableLogEvent {
    return {
      level: this.level,
      spanId: `${this.traceId}-${this.spanId}`,
      timestamp: instantToHrTime(this.timestamp),
      message: this.message,
      attributes: serializeExtendedAttributes(this.attributes),
    }
  }
}

function serializeExtendedAttributes(attributes: ExtendedAttributes): Attributes {
  const serializedAttributes: Attributes = {}

  for (const [key, value] of Object.entries(attributes)) {
    if (value instanceof Error) {
      serializedAttributes[key] = String(value)
    } else {
      serializedAttributes[key] = value
    }
  }

  return serializedAttributes
}

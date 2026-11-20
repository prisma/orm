import {
  Attributes,
  AttributeValue,
  Exception,
  HrTime,
  Link,
  Span,
  SpanContext,
  SpanKind,
  SpanStatus,
  TimeInput,
} from '@opentelemetry/api'
import { Temporal } from 'temporal-polyfill'

import { instantToHrTime } from '../formats/hr-time'
import { ExportableSpanId, parseSpanId, parseTraceId } from './id'
import { ExtendedSpanOptions } from './options'

/**
 * A span in the format expected by the Prisma Client.
 */
export type ExportableSpan = {
  id: ExportableSpanId
  parentId: ExportableSpanId | null
  name: string
  startTime: HrTime
  endTime: HrTime
  kind: ExportableSpanKind
  attributes?: Attributes
  links?: ExportableSpanId[]
}

/**
 * OpenTelemetry span kind in the format expected by the Prisma Client.
 */
export type ExportableSpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'

/**
 * Serialize an OpenTelemetry span kind to the format expected by the Prisma Client.
 */
export function serializeSpanKind(kind: SpanKind): ExportableSpanKind {
  switch (kind) {
    case SpanKind.INTERNAL:
      return 'internal'
    case SpanKind.SERVER:
      return 'server'
    case SpanKind.CLIENT:
      return 'client'
    case SpanKind.PRODUCER:
      return 'producer'
    case SpanKind.CONSUMER:
      return 'consumer'
    default:
      throw new Error(`Unknown span kind: ${kind satisfies never}`)
  }
}

type SpanProxyConstructorOptions = {
  span: Span
  parentSpan: Span | undefined
  spanOptions: ExtendedSpanOptions
  trueStartTime: Temporal.Instant
}

/**
 * Wraps an original OpenTelemetry {@link Span} and records all information we
 * need to export it to the Prisma Client.
 *
 * Normally, a finished span exposing this information for reading is only
 * available in the `onEnd` hook in a span processor. We, however, need to
 * retrieve it immediately after finishing the span in our code.
 */
export class SpanProxy implements Span {
  readonly #span: Span
  readonly #parentSpan: Span | undefined
  readonly #startTime: HrTime
  #name: string
  readonly #kind: SpanKind
  readonly #attributes: Attributes
  readonly #links: Link[]

  constructor(options: SpanProxyConstructorOptions) {
    this.#span = options.span
    this.#parentSpan = options.parentSpan
    this.#name = options.spanOptions.name
    this.#kind = options.spanOptions.kind ?? SpanKind.INTERNAL
    this.#attributes = options.spanOptions.attributes ?? {}
    this.#links = options.spanOptions.links ?? []

    if (options.spanOptions.startTime) {
      this.#startTime = timeInputToHrTime(options.spanOptions.startTime)
    } else {
      this.#startTime = instantToHrTime(options.trueStartTime)
    }
  }

  /**
   * Calls {@link Span#end} and exports the span in the format expected by the
   * Prisma Client.
   *
   * This operation is combined in a single method to statically guarantee the
   * consistency of the end time in both invocations.
   */
  endAndExport(endTime: Temporal.Instant): ExportableSpan {
    const endTimeAsHrTime = instantToHrTime(endTime)

    this.#span.end(endTimeAsHrTime)

    const spanContext = this.#span.spanContext()
    const parentSpanContext = this.#parentSpan?.spanContext()

    const traceId = parseTraceId(spanContext.traceId)
    const spanId = parseSpanId(spanContext.spanId)
    const id: ExportableSpanId = `${traceId}-${spanId}`

    let parentId: ExportableSpanId | null = null

    if (parentSpanContext !== undefined) {
      const parentTraceId = parseTraceId(parentSpanContext.traceId)
      const parentSpanId = parseSpanId(parentSpanContext.spanId)
      parentId = `${parentTraceId}-${parentSpanId}`
    }

    let attributes: Attributes | undefined

    if (Object.keys(this.#attributes).length > 0) {
      attributes = this.#attributes
    }

    let links: ExportableSpanId[] | undefined

    if (this.#links.length > 0) {
      links = this.#links.map((link): ExportableSpanId => {
        const linkTraceId = parseTraceId(link.context.traceId)
        const linkSpanId = parseSpanId(link.context.spanId)
        return `${linkTraceId}-${linkSpanId}`
      })
    }

    return {
      id,
      parentId,
      attributes,
      links,
      name: `prisma:accelerate:${this.#name}`,
      kind: serializeSpanKind(this.#kind),
      startTime: this.#startTime,
      endTime: instantToHrTime(endTime),
    }
  }

  /*
   * Span interface implementation below
   */

  spanContext(): SpanContext {
    return this.#span.spanContext()
  }

  setAttribute(key: string, value: AttributeValue): this {
    this.#attributes[key] = value
    this.#span.setAttribute(key, value)
    return this
  }

  setAttributes(attributes: Attributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      this.#attributes[key] = value
    }
    this.#span.setAttributes(attributes)
    return this
  }

  addEvent(name: string, attributesOrStartTime?: Attributes | TimeInput, startTime?: TimeInput): this {
    this.#span.addEvent(name, attributesOrStartTime, startTime)
    return this
  }

  addLink(link: Link): this {
    this.#links.push(link)
    this.#span.addLink(link)
    return this
  }

  addLinks(links: Link[]): this {
    this.#links.push(...links)
    this.#span.addLinks(links)
    return this
  }

  setStatus(status: SpanStatus): this {
    this.#span.setStatus(status)
    return this
  }

  updateName(name: string): this {
    this.#name = name
    this.#span.updateName(name)
    return this
  }

  end(endTime?: TimeInput): void {
    this.#span.end(endTime)
  }

  isRecording(): boolean {
    return this.#span.isRecording()
  }

  recordException(exception: Exception, time?: TimeInput): void {
    this.#span.recordException(exception, time)
  }
}

function timeInputToHrTime(timeInput: TimeInput): HrTime {
  if (Array.isArray(timeInput)) {
    return timeInput
  }

  const milliseconds = Number(timeInput)
  const instant = Temporal.Instant.fromEpochMilliseconds(milliseconds)

  return instantToHrTime(instant)
}

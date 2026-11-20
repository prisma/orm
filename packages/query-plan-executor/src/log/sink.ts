import { ExportableLogEvent, LogEvent } from './event'
import { FilterDecision, LogFilter } from './filter'
import { ConsoleFormatter } from './format'

/**
 * Represents a log sink that writes log events to a destination.
 */
export interface LogSink {
  write(event: LogEvent): void
}

/**
 * A log sink that writes log events to the console.
 */
export class ConsoleSink implements LogSink {
  readonly #formatter: ConsoleFormatter

  constructor(formatter: ConsoleFormatter) {
    this.#formatter = formatter
  }

  write(event: LogEvent): void {
    const parts = this.#formatter.format(event)

    switch (event.level) {
      case 'debug':
        console.debug(...parts)
        break

      case 'query':
        console.log(...parts)
        break

      case 'info':
        console.info(...parts)
        break

      case 'warn':
        console.warn(...parts)
        break

      case 'error':
        console.error(...parts)
        break

      default:
        throw new Error(`Invalid log level: ${event.level satisfies never}`)
    }
  }
}

/**
 * A log sink that captures log events in memory.
 */
export class CapturingSink implements LogSink {
  readonly events: LogEvent[] = []

  write(event: LogEvent): void {
    this.events.push(event)
  }

  export(): ExportableLogEvent[] {
    return this.events.map((event) => event.export())
  }
}

/**
 * A log sink that silently drops all log events.
 */
export class DroppingSink implements LogSink {
  write(_: LogEvent): void {
    // No-op
  }
}

/**
 * A log sink that writes log events to multiple downstream sinks.
 */
export class CompositeSink implements LogSink {
  readonly #downstream: LogSink[]

  constructor(...sinks: LogSink[]) {
    this.#downstream = sinks
  }

  write(event: LogEvent): void {
    for (const sink of this.#downstream) {
      sink.write(event)
    }
  }
}

/**
 * A log sink that filters log events based on a given filter.
 */
export class FilteringSink implements LogSink {
  readonly #inner: LogSink
  readonly #filter: LogFilter

  constructor(sink: LogSink, filter: LogFilter) {
    this.#inner = sink
    this.#filter = filter
  }

  write(event: LogEvent): void {
    if (this.#filter(event) === FilterDecision.Keep) {
      this.#inner.write(event)
    }
  }
}

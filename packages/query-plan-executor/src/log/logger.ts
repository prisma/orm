import { ExtendedAttributes, LogEvent } from './event'
import { LogLevel } from './log-level'
import { LogSink } from './sink'

/**
 * Core logger class that writes log events to a sink.
 */
export class Logger {
  /** The log sink that will receive log events */
  readonly sink: LogSink

  /**
   * Creates a new logger instance.
   *
   * @param sink The sink that will receive log events
   */
  constructor(sink: LogSink) {
    this.sink = sink
  }

  /**
   * Logs a message with the specified level and attributes.
   *
   * @param level The log level
   * @param message The message to log
   * @param attributes Optional key-value pairs to include with the log event
   */
  log(level: LogLevel, message: string, attributes?: ExtendedAttributes): void {
    this.sink.write(new LogEvent(level, message, attributes))
  }

  /**
   * Logs a debug message.
   *
   * @param message The message to log
   * @param attributes Optional key-value pairs to include with the log event
   */
  debug(message: string, attributes?: ExtendedAttributes): void {
    this.log('debug', message, attributes)
  }

  /**
   * Logs a database query event.
   *
   * @param message The message to log
   * @param attributes Optional key-value pairs to include with the log event
   */
  query(message: string, attributes?: ExtendedAttributes): void {
    this.log('query', message, attributes)
  }

  /**
   * Logs an informational message.
   *
   * @param message The message to log
   * @param attributes Optional key-value pairs to include with the log event
   */
  info(message: string, attributes?: ExtendedAttributes): void {
    this.log('info', message, attributes)
  }

  /**
   * Logs a warning message.
   *
   * @param message The message to log
   * @param attributes Optional key-value pairs to include with the log event
   */
  warn(message: string, attributes?: ExtendedAttributes): void {
    this.log('warn', message, attributes)
  }

  /**
   * Logs an error message.
   *
   * @param message The message to log
   * @param attributes Optional key-value pairs to include with the log event
   */
  error(message: string, attributes?: ExtendedAttributes): void {
    this.log('error', message, attributes)
  }
}

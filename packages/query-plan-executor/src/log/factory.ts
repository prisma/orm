import { thresholdLogFilter } from './filter'
import { createLogFormatter, LogFormat } from './format'
import { LogLevel } from './log-level'
import { Logger } from './logger'
import { ConsoleSink, DroppingSink, FilteringSink } from './sink'

/**
 * Creates a logger that keeps log events with a level greater than or equal
 * to {@link logLevel} and outputs them to console using format {@link logFormat}.
 * When `logLevel` is `'off'`, all log events are dropped.
 */
export function createConsoleLogger(logFormat: LogFormat, logLevel: LogLevel | 'off'): Logger {
  const sink =
    logLevel === 'off'
      ? new DroppingSink()
      : new FilteringSink(new ConsoleSink(createLogFormatter(logFormat)), thresholdLogFilter(logLevel))

  return new Logger(sink)
}

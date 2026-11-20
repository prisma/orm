import { LogEvent } from './event'
import { LogLevel } from './log-level'

const logLevels: Record<LogLevel, number> = {
  debug: 0,
  query: 1,
  info: 2,
  warn: 3,
  error: 4,
}

/**
 * Decision to keep or discard a log event after filtering.
 */
export const enum FilterDecision {
  /** Keep the log event, allowing it to be processed */
  Keep,
  /** Discard the log event, preventing further processing */
  Discard,
}

/**
 * Function that decides whether to keep or discard a log event.
 *
 * @param event The log event to filter
 * @returns Decision to keep or discard the event
 */
export type LogFilter = (event: LogEvent) => FilterDecision

/**
 * Creates a log filter that keeps events with a level greater than or equal to the specified minimum level.
 */
export const thresholdLogFilter = (minLevel: LogLevel) => (event: LogEvent) => {
  return logLevels[event.level] >= logLevels[minLevel] ? FilterDecision.Keep : FilterDecision.Discard
}

/**
 * Creates a log filter that keeps events with a level included in the specified array of levels.
 * This is the logic the Prisma Client expects when retrieving logs from the engine.
 */
export const discreteLogFilter = (levels: LogLevel[]) => (event: LogEvent) => {
  return levels.includes(event.level) ? FilterDecision.Keep : FilterDecision.Discard
}

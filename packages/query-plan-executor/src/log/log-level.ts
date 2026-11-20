/**
 * List of all supported log levels.
 */
export const validLogLevels = ['debug', 'query', 'info', 'warn', 'error'] as const

/**
 * Level of a log event.
 *
 * This is mostly standard but includes an additional `query` level because
 * Prisma Client treats it as such. In the query engine it was emulated with
 * unclear semantics on top of the actual levels, but here we explicitly define
 * it as a real level between `debug` and `info`.
 */
export type LogLevel = (typeof validLogLevels)[number]

/**
 * Parses a log level string into a LogLevel.
 *
 * Throws an error if the string is not a valid log level.
 */
export function parseLogLevel(level: string): LogLevel {
  if (!validLogLevels.includes(level as LogLevel)) {
    throw new Error(`Invalid log level: ${level}`)
  }
  return level as LogLevel
}

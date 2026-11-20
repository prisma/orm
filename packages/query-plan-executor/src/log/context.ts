import { context } from '@opentelemetry/api'

import { Logger } from './logger'

const LOG_CONTEXT = Symbol('LogContext')

/**
 * Gets the logger from the current OpenTelemetry context.
 *
 * @throws {Error} if no logger is found in the context or if the value is not a {@link Logger}
 */
export function getActiveLogger(): Logger {
  const logger = context.active().getValue(LOG_CONTEXT)

  if (!logger) {
    throw new Error('No active logger found')
  }

  if (logger instanceof Logger) {
    return logger
  }

  throw new Error('Active logger is not an instance of Logger')
}

/**
 * Runs a function with a new OpenTelemetry context containing the provided logger.
 *
 * @param logger The logger to make active
 * @param fn The function to run with the logger in context
 * @returns The return value of the function
 */
export function withActiveLogger<T>(logger: Logger, fn: () => T): T {
  return context.with(context.active().setValue(LOG_CONTEXT, logger), fn)
}

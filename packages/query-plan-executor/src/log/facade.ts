import { getActiveLogger } from './context'
import { ExtendedAttributes } from './event'

/**
 * Logs a debug message using the active logger.
 *
 * @param message The message to log
 * @param attributes Optional key-value pairs to include with the log event
 * @throws {Error} if no active logger is found
 */
export function debug(message: string, attributes?: ExtendedAttributes) {
  getActiveLogger().debug(message, attributes)
}

/**
 * Logs a database query event using the active logger.
 *
 * @param message The message to log
 * @param attributes Optional key-value pairs to include with the log event
 * @throws {Error} if no active logger is found
 */
export function query(message: string, attributes?: ExtendedAttributes) {
  getActiveLogger().query(message, attributes)
}

/**
 * Logs an informational message using the active logger.
 *
 * @param message The message to log
 * @param attributes Optional key-value pairs to include with the log event
 * @throws {Error} if no active logger is found
 */
export function info(message: string, attributes?: ExtendedAttributes) {
  getActiveLogger().info(message, attributes)
}

/**
 * Logs a warning message using the active logger.
 *
 * @param message The message to log
 * @param attributes Optional key-value pairs to include with the log event
 * @throws {Error} if no active logger is found
 */
export function warn(message: string, attributes?: ExtendedAttributes) {
  getActiveLogger().warn(message, attributes)
}

/**
 * Logs an error message using the active logger.
 *
 * @param message The message to log
 * @param attributes Optional key-value pairs to include with the log event
 * @throws {Error} if no active logger is found
 */
export function error(message: string, attributes?: ExtendedAttributes) {
  getActiveLogger().error(message, attributes)
}

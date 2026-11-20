import { Temporal } from 'temporal-polyfill'

import { LogFormat } from './log/format'
import { LogLevel } from './log/log-level'

/**
 * Log level options accepted by the console logger.
 */
export type ConsoleLogLevel = LogLevel | 'off'

/**
 * Configuration options for the query plan executor server.
 */
export interface Options {
  /** Database connection URL */
  databaseUrl: string
  /** Maximum time to wait for a query to complete */
  queryTimeout: Temporal.Duration
  /** Maximum timeout allowed for a transaction */
  maxTransactionTimeout: Temporal.Duration
  /** Maximum time to wait for a transaction to start */
  maxTransactionWaitTime: Temporal.Duration
  /** Maximum size of a response in bytes */
  maxResponseSize: number
  /**
   * Initializes a logging context and creates a logger with the specified options
   * in the scope of each HTTP request in a middleware. This is useful when the
   * lifetime of the server needs to be managed externally, but it is less efficient
   * than creating a logger once and running the server inside its scope.
   */
  perRequestLogContext?: LogOptions
}

/**
 * Log options for the logging middleware.
 */
export interface LogOptions {
  /** Minimum log level to output */
  logLevel: ConsoleLogLevel
  /** Format of log output */
  logFormat: LogFormat
}

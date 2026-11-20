import { Temporal } from 'temporal-polyfill'

/**
 * Resource limits defined for the user.
 */

export type ResourceLimits = {
  /**
   * Maximum duration for a query to run before it is canceled.
   */
  queryTimeout: Temporal.Duration

  /**
   * Maximum allowed transaction duration. If a client specifies a longer
   * duration when starting an interactive transaction, the Query Plan Executor
   * will respond with an error.
   */
  maxTransactionTimeout: Temporal.Duration

  /**
   * Maximum allowed size of a response in bytes.
   */
  maxResponseSize: number
}

/**
 * Exception thrown when a resource limit is exceeded.
 */
export class ResourceLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceLimitException'
  }
}

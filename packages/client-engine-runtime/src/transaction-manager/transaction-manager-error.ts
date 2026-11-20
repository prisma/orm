import { UserFacingError } from '../user-facing-error'

export class TransactionManagerError extends UserFacingError {
  name = 'TransactionManagerError'

  constructor(message: string, meta?: Record<string, unknown>) {
    super('Transaction API error: ' + message, 'P2028', meta)
  }
}

export class TransactionNotFoundError extends TransactionManagerError {
  constructor() {
    super(
      "Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting.",
    )
  }
}

export class TransactionClosedError extends TransactionManagerError {
  constructor(operation: string) {
    super(`Transaction already closed: A ${operation} cannot be executed on a committed transaction.`)
  }
}

export class TransactionRolledBackError extends TransactionManagerError {
  constructor(operation: string) {
    super(`Transaction already closed: A ${operation} cannot be executed on a transaction that was rolled back.`)
  }
}

export class NestedTransactionRolledBackError extends TransactionManagerError {
  constructor(operation: string) {
    super(
      `Nested transaction already closed: A ${operation} cannot be executed on a nested transaction that was rolled back.`,
    )
  }
}

export class TransactionStartTimeoutError extends TransactionManagerError {
  constructor() {
    super('Unable to start a transaction in the given time.')
  }
}

export class TransactionExecutionTimeoutError extends TransactionManagerError {
  constructor(operation: string, { timeout, timeTaken }: { timeout: number; timeTaken: number }) {
    super(
      `A ${operation} cannot be executed on an expired transaction. \
The timeout for this transaction was ${timeout} ms, however ${timeTaken} ms passed since the start \
of the transaction. Consider increasing the interactive transaction timeout \
or doing less work in the transaction.`,
      { operation, timeout, timeTaken },
    )
  }
}

export class TransactionInternalConsistencyError extends TransactionManagerError {
  constructor(message: string) {
    super(`Internal Consistency Error: ${message}`)
  }
}

export class InvalidTransactionIsolationLevelError extends TransactionManagerError {
  constructor(isolationLevel: string) {
    super(`Invalid isolation level: ${isolationLevel}`, { isolationLevel })
  }
}

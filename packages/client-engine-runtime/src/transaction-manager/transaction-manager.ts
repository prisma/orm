import { Debug } from '@prisma/debug'
import { ConnectionInfo, SqlDriverAdapter, SqlQuery, SqlQueryable, Transaction } from '@prisma/driver-adapter-utils'

import { randomUUID } from '../crypto'
import { QueryEvent } from '../events'
import type { SchemaProvider } from '../schema'
import { TracingHelper, withQuerySpanAndEvent } from '../tracing'
import { rethrowAsUserFacing } from '../user-facing-error'
import { assertNever } from '../utils'
import { once } from '../web-platform'
import { Options, TransactionInfo } from './transaction'
import {
  InvalidTransactionIsolationLevelError,
  TransactionClosedError,
  TransactionExecutionTimeoutError,
  TransactionInternalConsistencyError,
  TransactionManagerError,
  TransactionNotFoundError,
  TransactionRolledBackError,
  TransactionStartTimeoutError,
} from './transaction-manager-error'

const MAX_CLOSED_TRANSACTIONS = 100

/**
 * How long {@link TransactionManager.cancelAllTransactions} waits for an aborted start to roll
 * back before letting the caller carry on and dispose the driver adapter.
 *
 * The rollback cannot happen until the driver settles the `startTransaction` promise it is
 * still holding, and a driver stuck on a dead connection may never do so. Waiting is worth a
 * moment — it is what lets the transaction be closed cleanly — but not at the cost of hanging
 * disconnect forever. This is deliberately not derived from `maxWait`: that is the caller's
 * patience for opening a transaction, not a bound on how long shutdown may stall.
 */
const CANCEL_ROLLBACK_GRACE_MS = 2_000

type TransactionWrapper = {
  id: string
  timer?: NodeJS.Timeout
  timeout: number | undefined
  startedAt: number
  transaction?: Transaction
  operationQueue: Promise<void>
  depth: number
  savepoints: string[]
  savepointCounter: number
} & TransactionState

type TransactionState =
  | { status: 'waiting' | 'running' | 'committed' | 'rolled_back' | 'timed_out' }
  | { status: 'closing'; closing: Promise<void>; reason: 'committed' | 'rolled_back' | 'timed_out' }

/**
 * A transaction whose `startTransaction` call has not returned yet. Such a transaction is not
 * in {@link TransactionManager.transactions} until the driver hands it over, so it is only
 * reachable through here.
 */
type StartingTransaction = {
  abortController: AbortController
  /**
   * Resolves once the start has been dealt with: either adopted as a running transaction, or
   * discarded with its transaction rolled back and its connection released.
   */
  settled: Promise<void>
  markSettled: () => void
}

function trackStartingTransaction(): StartingTransaction {
  let markSettled!: () => void
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve
  })
  return { abortController: new AbortController(), settled, markSettled }
}

const debug = Debug('prisma:client:transactionManager')

const COMMIT_QUERY = (): SqlQuery => ({ sql: 'COMMIT', args: [], argTypes: [] })
const ROLLBACK_QUERY = (): SqlQuery => ({ sql: 'ROLLBACK', args: [], argTypes: [] })

const PHANTOM_COMMIT_QUERY = (): SqlQuery => ({
  sql: '-- Implicit "COMMIT" query via underlying driver',
  args: [],
  argTypes: [],
})
const PHANTOM_ROLLBACK_QUERY = (): SqlQuery => ({
  sql: '-- Implicit "ROLLBACK" query via underlying driver',
  args: [],
  argTypes: [],
})

export class TransactionManager {
  // The map of active transactions.
  private transactions: Map<string, TransactionWrapper> = new Map()
  // List of last closed transactions. Max MAX_CLOSED_TRANSACTIONS entries.
  // Used to provide better error messages than a generic "transaction not found".
  private closedTransactions: TransactionWrapper[] = []
  // Transactions that are still being started. Tracked separately so that
  // `cancelAllTransactions` can reach them: they are not in `transactions` yet.
  readonly #startingTransactions: Set<StartingTransaction> = new Set()
  private readonly driverAdapter: SqlDriverAdapter
  private readonly transactionOptions: Options
  private readonly tracingHelper: TracingHelper
  readonly #onQuery?: (event: QueryEvent) => void
  readonly #provider?: SchemaProvider
  readonly #connectionInfo?: ConnectionInfo

  constructor({
    driverAdapter,
    transactionOptions,
    tracingHelper,
    onQuery,
    provider,
  }: {
    driverAdapter: SqlDriverAdapter
    transactionOptions: Options
    tracingHelper: TracingHelper
    onQuery?: (event: QueryEvent) => void
    provider?: SchemaProvider
  }) {
    this.driverAdapter = driverAdapter
    this.transactionOptions = transactionOptions
    this.tracingHelper = tracingHelper
    this.#onQuery = onQuery
    this.#provider = provider
    this.#connectionInfo = driverAdapter.getConnectionInfo?.()
  }

  /**
   * Starts an internal transaction. The difference to `startTransaction` is that it does not
   * use the default transaction options from the `TransactionManager`, which in practice means
   * that it does not apply the default timeouts.
   */
  async startInternalTransaction(options?: Options): Promise<TransactionInfo> {
    const validatedOptions = options !== undefined ? this.#validateOptions(options) : {}
    return await this.tracingHelper.runInChildSpan('start_transaction', () =>
      this.#startTransactionImpl(validatedOptions),
    )
  }

  async startTransaction(options?: Options): Promise<TransactionInfo> {
    const validatedOptions = options !== undefined ? this.#validateOptions(options) : this.transactionOptions
    return await this.tracingHelper.runInChildSpan('start_transaction', () =>
      this.#startTransactionImpl(validatedOptions),
    )
  }

  async #startTransactionImpl(options: Options): Promise<TransactionInfo> {
    if (options.newTxId) {
      return await this.#withActiveTransactionLock(options.newTxId, 'start', async (existing) => {
        if (existing.status !== 'running') {
          throw new TransactionInternalConsistencyError(
            `Transaction in invalid state ${existing.status} when starting a nested transaction.`,
          )
        }
        if (!existing.transaction) {
          throw new TransactionInternalConsistencyError(
            `Transaction missing underlying driver transaction when starting a nested transaction.`,
          )
        }

        existing.depth += 1

        const savepointName = this.#nextSavepointName(existing)
        existing.savepoints.push(savepointName)
        try {
          await this.#requiredCreateSavepoint(existing.transaction)(savepointName)
        } catch (e) {
          // Keep state consistent if creating the savepoint fails.
          existing.depth -= 1
          existing.savepoints.pop()
          throw e
        }

        return { id: existing.id }
      })
    }

    // Track the start before awaiting anything, so that a `cancelAllTransactions` arriving in
    // the meantime can still see it. Until the driver hands the transaction over, this is the
    // only place it is reachable from.
    const starting = trackStartingTransaction()
    const { abortController } = starting
    this.#startingTransactions.add(starting)

    // Set once the start is abandoned, so that `settled` waits for the rollback rather than
    // resolving as soon as this method returns.
    let discarding: Promise<void> | undefined

    try {
      const transaction: TransactionWrapper = {
        id: await randomUUID(),
        status: 'waiting',
        timer: undefined,
        timeout: options.timeout,
        startedAt: Date.now(),
        transaction: undefined,
        operationQueue: Promise.resolve(),
        depth: 1,
        savepoints: [],
        savepointCounter: 0,
      }

      // An abort that arrived while the id was being generated would be missed by the listener
      // registered below, since the event has already fired. Nothing has been opened yet, so
      // there is nothing to roll back.
      if (abortController.signal.aborted) {
        throw new TransactionStartTimeoutError()
      }

      // Start timeout to wait for transaction to be started.
      const startTimer = createTimeoutIfDefined(() => abortController.abort(), options.maxWait)
      startTimer?.unref?.()

      // Keep a reference to the startTransaction promise so we can clean up
      // if the timeout fires before it completes.
      const startTransactionPromise = this.driverAdapter
        .startTransaction(options.isolationLevel)
        .catch(rethrowAsUserFacing)

      transaction.transaction = await Promise.race([
        startTransactionPromise.finally(() => clearTimeout(startTimer)),
        once(abortController.signal, 'abort').then(() => undefined),
      ])

      this.transactions.set(transaction.id, transaction)

      // Transaction status might have timed out while waiting for transaction to start. => Check for it!
      switch (transaction.status) {
        case 'waiting':
          if (abortController.signal.aborted) {
            // The driver may have won the race and only then been aborted, leaving a
            // transaction here. Ownership of it passes to `#discardStartedTransaction`, which
            // holds its own reference, so drop this one: otherwise `#closeTransaction` below
            // rolls back and releases the same transaction a second time.
            transaction.transaction = undefined

            discarding = this.#discardStartedTransaction(startTransactionPromise)

            // Call `#closeTransaction` to update internal state. It won't actually attempt
            // to rollback the tx itself because `transaction.transaction` is undefined.
            await this.#closeTransaction(transaction, 'timed_out')

            throw new TransactionStartTimeoutError()
          }

          transaction.status = 'running'
          // Startup is over, so the execution timeout below and the `timeTaken` diagnostic
          // measure the transaction itself rather than the wait to open it.
          transaction.startedAt = Date.now()
          // Start timeout to wait for transaction to be finished.
          transaction.timer = this.#startTransactionTimeout(transaction.id, options.timeout)
          return { id: transaction.id }
        case 'timed_out':
        case 'running':
        case 'committed':
        case 'rolled_back':
          throw new TransactionInternalConsistencyError(
            `Transaction in invalid state ${transaction.status} although it just finished startup.`,
          )
        default:
          return assertNever(transaction['status'], 'Unknown transaction status.')
      }
    } finally {
      this.#startingTransactions.delete(starting)

      if (discarding) {
        void discarding.finally(starting.markSettled)
      } else {
        starting.markSettled()
      }
    }
  }

  /**
   * Rolls back a transaction whose start was abandoned, and releases its connection.
   *
   * The `startTransaction` promise may still be running in the background. If it eventually
   * succeeds, we need to roll back and release the connection to avoid leaking it and
   * exhausting the connection pool. For adapters that don't use phantom queries (e.g. pg/neon),
   * `rollback()` only releases the connection without sending SQL, so we send an explicit
   * ROLLBACK first; otherwise the connection returns to the pool mid-transaction because
   * `BEGIN` already ran on the wire during startup.
   *
   * Errors are only logged: the caller has already reported the failure that led here.
   */
  async #discardStartedTransaction(startTransactionPromise: Promise<Transaction>): Promise<void> {
    try {
      const tx = await startTransactionPromise
      if (tx.options.usePhantomQuery) {
        await tx.rollback()
      } else {
        try {
          await tx.executeRaw(ROLLBACK_QUERY())
        } finally {
          await tx.rollback()
        }
      }
    } catch (e) {
      debug('error in discarded transaction:', e)
    }
  }

  async commitTransaction(transactionId: string): Promise<void> {
    return await this.tracingHelper.runInChildSpan('commit_transaction', async () => {
      await this.#withActiveTransactionLock(transactionId, 'commit', async (txw) => {
        if (txw.depth > 1) {
          if (!txw.transaction) throw new TransactionNotFoundError()
          const savepointName = txw.savepoints.at(-1)
          if (!savepointName) {
            throw new TransactionInternalConsistencyError(
              `Missing savepoint for nested commit. Depth: ${txw.depth}, transactionId: ${txw.id}`,
            )
          }
          try {
            await this.#releaseSavepoint(txw.transaction, savepointName)
          } finally {
            // Keep internal state consistent even if releasing the savepoint fails.
            txw.savepoints.pop()
            txw.depth -= 1
          }
          return
        }
        await this.#closeTransaction(txw, 'committed')
      })
    })
  }

  async rollbackTransaction(transactionId: string): Promise<void> {
    return await this.tracingHelper.runInChildSpan('rollback_transaction', async () => {
      await this.#withActiveTransactionLock(transactionId, 'rollback', async (txw) => {
        if (txw.depth > 1) {
          if (!txw.transaction) throw new TransactionNotFoundError()
          const savepointName = txw.savepoints.at(-1)
          if (!savepointName) {
            throw new TransactionInternalConsistencyError(
              `Missing savepoint for nested rollback. Depth: ${txw.depth}, transactionId: ${txw.id}`,
            )
          }

          try {
            await this.#requiredRollbackToSavepoint(txw.transaction)(savepointName)
            await this.#releaseSavepoint(txw.transaction, savepointName)
          } finally {
            // Keep internal state consistent even if rollback/release fails.
            txw.savepoints.pop()
            txw.depth -= 1
          }
          return
        }
        await this.#closeTransaction(txw, 'rolled_back')
      })
    })
  }

  async getTransaction(txInfo: TransactionInfo, operation: string): Promise<Transaction> {
    let tx = this.#getActiveOrClosingTransaction(txInfo.id, operation)
    if (tx.status === 'closing') {
      await tx.closing
      // Fetch again to ensure proper error propagation after it's been closed.
      tx = this.#getActiveOrClosingTransaction(txInfo.id, operation)
    }
    if (!tx.transaction) throw new TransactionNotFoundError()
    return tx.transaction
  }

  #getActiveOrClosingTransaction(transactionId: string, operation: string): TransactionWrapper {
    const transaction = this.transactions.get(transactionId)

    if (!transaction) {
      const closedTransaction = this.closedTransactions.find((tx) => tx.id === transactionId)
      if (closedTransaction) {
        debug('Transaction already closed.', { transactionId, status: closedTransaction.status })
        switch (closedTransaction.status) {
          case 'closing':
          case 'waiting':
          case 'running':
            throw new TransactionInternalConsistencyError('Active transaction found in closed transactions list.')
          case 'committed':
            throw new TransactionClosedError(operation)
          case 'rolled_back':
            throw new TransactionRolledBackError(operation)
          case 'timed_out':
            throw new TransactionExecutionTimeoutError(operation, {
              timeout: closedTransaction.timeout!,
              timeTaken: Date.now() - closedTransaction.startedAt,
            })
        }
      } else {
        debug(`Transaction not found.`, transactionId)
        throw new TransactionNotFoundError()
      }
    }

    if (['committed', 'rolled_back', 'timed_out'].includes(transaction.status)) {
      throw new TransactionInternalConsistencyError('Closed transaction found in active transactions map.')
    }

    return transaction
  }

  async cancelAllTransactions(): Promise<void> {
    // Transactions that are still starting are not in `transactions` yet. Abort them so they
    // discard whatever the driver hands over, and wait below, so that callers can dispose the
    // driver adapter without cutting an in-progress rollback short.
    const starting = [...this.#startingTransactions]
    for (const { abortController } of starting) {
      abortController.abort()
    }

    // TODO: call `map` on the iterator directly without collecting it into an array first
    // once we drop support for Node.js 18 and 20.
    await Promise.allSettled([
      ...[...this.transactions.values()].map((tx) =>
        this.#runSerialized(tx, async () => {
          const current = this.transactions.get(tx.id)
          if (current) {
            await this.#closeTransaction(current, 'rolled_back')
          }
        }),
      ),
      ...starting.map(({ settled }) => settleWithin(settled, CANCEL_ROLLBACK_GRACE_MS)),
    ])
  }

  #nextSavepointName(transaction: TransactionWrapper): string {
    return `prisma_sp_${transaction.savepointCounter++}`
  }

  #requiredCreateSavepoint(transaction: Transaction): (name: string) => Promise<void> {
    if (transaction.createSavepoint) {
      return transaction.createSavepoint.bind(transaction)
    }

    throw new TransactionManagerError(
      `Nested transactions are not supported by adapter "${transaction.adapterName}" (${transaction.provider}): createSavepoint is not implemented.`,
    )
  }

  #requiredRollbackToSavepoint(transaction: Transaction): (name: string) => Promise<void> {
    if (transaction.rollbackToSavepoint) {
      return transaction.rollbackToSavepoint.bind(transaction)
    }

    throw new TransactionManagerError(
      `Nested transactions are not supported by adapter "${transaction.adapterName}" (${transaction.provider}): rollbackToSavepoint is not implemented.`,
    )
  }

  async #releaseSavepoint(transaction: Transaction, name: string): Promise<void> {
    if (transaction.releaseSavepoint) {
      await transaction.releaseSavepoint(name)
    }
  }

  #debugTransactionAlreadyClosedOnTimeout(transactionId: string): void {
    // Transaction was already committed or rolled back when timeout happened.
    // Should normally not happen as timeout is cancelled when transaction is committed or rolled back.
    // No further action needed though.
    debug('Transaction already committed or rolled back when timeout happened.', transactionId)
  }

  #startTransactionTimeout(transactionId: string, timeout: number | undefined): NodeJS.Timeout | undefined {
    const timeoutStartedAt = Date.now()
    const timer = createTimeoutIfDefined(async () => {
      // The timer callback's returned promise is not awaited by anyone, so any rejection from
      // the rollback chain below (e.g. the adapter failing to send ROLLBACK on a connection the
      // database already killed) would otherwise surface as an unhandled rejection and crash the
      // process — outside the user's try/catch around $transaction. By the time the timeout fires
      // the transaction is over by definition and the user can no longer act on it, so we swallow
      // the failure here after logging it. Subsequent queries on the same transaction handle still
      // reject cleanly via the expired-transaction path.
      try {
        debug('Transaction timed out.', { transactionId, timeoutStartedAt, timeout })

        const tx = this.transactions.get(transactionId)
        if (!tx) {
          this.#debugTransactionAlreadyClosedOnTimeout(transactionId)
          return
        }

        await this.#runSerialized(tx, async () => {
          const current = this.transactions.get(transactionId)
          if (current && ['running', 'waiting'].includes(current.status)) {
            await this.#closeTransaction(current, 'timed_out')
          } else {
            this.#debugTransactionAlreadyClosedOnTimeout(transactionId)
          }
        })
      } catch (error) {
        debug('Error while closing timed-out transaction.', { transactionId, error })
      }
    }, timeout)

    timer?.unref?.()
    return timer
  }

  // Any operation that mutates or closes a transaction must run through this lock so
  // status/savepoint/depth checks and updates happen against a stable view of state.
  async #withActiveTransactionLock<T>(
    transactionId: string,
    operation: string,
    callback: (tx: TransactionWrapper) => Promise<T>,
  ): Promise<T> {
    const tx = this.#getActiveOrClosingTransaction(transactionId, operation)
    return await this.#runSerialized(tx, async () => {
      const current = this.#getActiveOrClosingTransaction(transactionId, operation)
      return await callback(current)
    })
  }

  // Serializes operations per transaction id to prevent interleaving across awaits.
  // This avoids races where one operation mutates savepoint/depth state while another
  // operation is suspended, which could otherwise corrupt cleanup logic.
  async #runSerialized<T>(tx: TransactionWrapper, callback: () => Promise<T>): Promise<T> {
    const previousOperation = tx.operationQueue
    let releaseOperationLock!: () => void
    tx.operationQueue = new Promise<void>((resolve) => {
      releaseOperationLock = resolve
    })

    await previousOperation
    try {
      return await callback()
    } finally {
      releaseOperationLock()
    }
  }

  async #closeTransaction(tx: TransactionWrapper, status: 'committed' | 'rolled_back' | 'timed_out'): Promise<void> {
    const createClosingPromise = async () => {
      debug('Closing transaction.', { transactionId: tx.id, status })
      try {
        if (tx.transaction && status === 'committed') {
          if (tx.transaction.options.usePhantomQuery) {
            await this.#withQuerySpanAndEvent(PHANTOM_COMMIT_QUERY(), tx.transaction, () => tx.transaction!.commit())
          } else {
            const query = COMMIT_QUERY()
            await this.#withQuerySpanAndEvent(query, tx.transaction, () => tx.transaction!.executeRaw(query)).then(
              () => tx.transaction!.commit(),
              (err) => {
                const fail = () => Promise.reject(err)
                return tx.transaction!.rollback().then(fail, fail)
              },
            )
          }
        } else if (tx.transaction) {
          if (tx.transaction.options.usePhantomQuery) {
            await this.#withQuerySpanAndEvent(PHANTOM_ROLLBACK_QUERY(), tx.transaction, () =>
              tx.transaction!.rollback(),
            )
          } else {
            const query = ROLLBACK_QUERY()
            try {
              await this.#withQuerySpanAndEvent(query, tx.transaction, () => tx.transaction!.executeRaw(query))
            } finally {
              await tx.transaction.rollback()
            }
          }
        }
      } finally {
        tx.status = status
        clearTimeout(tx.timer)
        tx.timer = undefined

        this.transactions.delete(tx.id)

        this.closedTransactions.push(tx)
        if (this.closedTransactions.length > MAX_CLOSED_TRANSACTIONS) {
          this.closedTransactions.shift()
        }
      }
    }

    if (tx.status === 'closing') {
      await tx.closing
      // Fetch again to ensure proper error propagation after it's been closed.
      this.#getActiveOrClosingTransaction(tx.id, status === 'committed' ? 'commit' : 'rollback')
    } else {
      await Object.assign(tx, {
        status: 'closing',
        reason: status,
        closing: createClosingPromise(),
      }).closing
    }
  }

  #validateOptions(options: Options) {
    // Supplying timeout default values is cared for upstream already.
    if (!options.timeout) throw new TransactionManagerError('timeout is required')
    if (!options.maxWait) throw new TransactionManagerError('maxWait is required')

    // Snapshot level only supported for MS SQL Server, which is not supported via driver adapters so far.
    if (options.isolationLevel === 'SNAPSHOT') throw new InvalidTransactionIsolationLevelError(options.isolationLevel)

    return {
      ...options,
      timeout: options.timeout,
      maxWait: options.maxWait,
    }
  }

  #withQuerySpanAndEvent<T>(query: SqlQuery, queryable: SqlQueryable, execute: () => Promise<T>): Promise<T> {
    return withQuerySpanAndEvent({
      query,
      execute,
      provider: this.#provider ?? queryable.provider,
      tracingHelper: this.tracingHelper,
      onQuery: this.#onQuery,
      connectionInfo: this.#connectionInfo,
    })
  }
}

function createTimeoutIfDefined(cb: () => void, ms: number | undefined): NodeJS.Timeout | undefined {
  return ms !== undefined ? setTimeout(cb, ms) : undefined
}

/**
 * Settles when `promise` does, or resolves after `timeout` milliseconds, whichever happens
 * first. A rejection is passed on rather than absorbed.
 */
function settleWithin(promise: Promise<void>, timeout: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined

  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeout)
    timer?.unref?.()
  })

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

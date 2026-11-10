import { Debug } from '@prisma/debug'
import { SqlDriverAdapter, SqlQuery, SqlQueryable, Transaction } from '@prisma/driver-adapter-utils'

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
 * How long a rollback waits on the driver before going ahead anyway: for statements still
 * running in the transaction, and, in {@link TransactionManager.cancelAllTransactions}, for an
 * aborted start to roll back before the caller disposes the driver adapter.
 *
 * A driver stuck on a dead connection may never settle what it is holding. Waiting is worth a
 * moment — it is what lets the transaction be closed cleanly — but not at the cost of never
 * rolling back or hanging disconnect forever. This is deliberately not derived from `maxWait`:
 * that is the caller's patience for opening a transaction, not a bound on how long a rollback
 * may stall.
 */
const ROLLBACK_GRACE_MS = 2_000

type ClosingReason = 'committed' | 'rolled_back' | 'timed_out'

/**
 * One level of a transaction: the outermost transaction, or a nested transaction on top of it.
 * Handles from {@link TransactionManager.getTransaction} belong to the scope that was innermost
 * when they were issued.
 */
type Scope = {
  savepoint: string | undefined
  closingReason?: ClosingReason
  runningStatements: Set<Promise<void>>
}

function createScope(savepoint: string | undefined): Scope {
  return { savepoint, closingReason: undefined, runningStatements: new Set() }
}

type TransactionWrapper = {
  id: string
  timer?: NodeJS.Timeout
  timeout: number | undefined
  startedAt: number
  transaction?: Transaction
  operationQueue: Promise<void>
  savepointCounter: number
  scopes: Scope[]
} & TransactionState

type TransactionState =
  | { status: 'waiting' | 'running' | ClosingReason }
  | { status: 'closing'; closing: Promise<void>; reason: ClosingReason }

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

        const savepointName = this.#nextSavepointName(existing)
        await this.#requiredCreateSavepoint(existing.transaction)(savepointName)
        existing.scopes.push(createScope(savepointName))

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
        savepointCounter: 0,
        scopes: [createScope(undefined)],
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
        const scope = innermostScope(txw)
        if (scope.savepoint !== undefined) {
          if (!txw.transaction) throw new TransactionNotFoundError()
          try {
            await this.#closeScopes([scope], 'committed')
            await this.#releaseSavepoint(txw.transaction, scope.savepoint)
          } finally {
            txw.scopes.pop()
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
        const scope = innermostScope(txw)
        if (scope.savepoint !== undefined) {
          try {
            await this.#closeScopes([scope], 'rolled_back')
            if (!txw.transaction) throw new TransactionNotFoundError()
            await this.#requiredRollbackToSavepoint(txw.transaction)(scope.savepoint)
            await this.#releaseSavepoint(txw.transaction, scope.savepoint)
          } finally {
            txw.scopes.pop()
          }
          return
        }
        await this.#closeTransaction(txw, 'rolled_back')
      })
    })
  }

  /**
   * Returns a handle for running statements in the transaction. The handle rejects every
   * statement issued after the transaction, or the nested transaction that is innermost now,
   * has started to close.
   */
  getTransaction(txInfo: TransactionInfo, operation: string): Promise<SqlQueryable> {
    return new Promise((resolve) => resolve(this.#issueHandle(txInfo, operation)))
  }

  #issueHandle(txInfo: TransactionInfo, operation: string): SqlQueryable {
    const tx = this.#getActiveOrClosingTransaction(txInfo.id, operation)
    if (tx.status === 'closing') throw closedTransactionError(tx, tx.reason, operation)
    if (!tx.transaction) throw new TransactionNotFoundError()
    return this.#guardedQueryable(tx, tx.transaction, innermostScope(tx), operation)
  }

  #guardedQueryable(tx: TransactionWrapper, transaction: Transaction, scope: Scope, operation: string): SqlQueryable {
    return {
      provider: transaction.provider,
      adapterName: transaction.adapterName,
      queryRaw: (query) => this.#runStatement(tx, scope, operation, () => transaction.queryRaw(query)),
      executeRaw: (query) => this.#runStatement(tx, scope, operation, () => transaction.executeRaw(query)),
    }
  }

  async #runStatement<T>(
    tx: TransactionWrapper,
    scope: Scope,
    operation: string,
    execute: () => Promise<T>,
  ): Promise<T> {
    if (scope.closingReason !== undefined) {
      throw closedTransactionError(tx, scope.closingReason, operation)
    }

    let markSettled!: () => void
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve
    })
    scope.runningStatements.add(settled)
    try {
      return await execute()
    } finally {
      scope.runningStatements.delete(settled)
      markSettled()
    }
  }

  /**
   * Stops `scopes` from accepting statements, then waits for the ones already running. A commit
   * waits for as long as they take; a rollback waits at most {@link ROLLBACK_GRACE_MS}.
   */
  async #closeScopes(scopes: Scope[], reason: ClosingReason): Promise<void> {
    for (const scope of scopes) {
      scope.closingReason ??= reason
    }

    const running = scopes.flatMap((scope) => [...scope.runningStatements])
    if (running.length === 0) return

    const allSettled = Promise.all(running).then(() => {})
    await (reason === 'committed' ? allSettled : settleWithin(allSettled, ROLLBACK_GRACE_MS))
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
          default:
            throw closedTransactionError(closedTransaction, closedTransaction.status, operation)
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
      ...starting.map(({ settled }) => settleWithin(settled, ROLLBACK_GRACE_MS)),
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
  // status/scope checks and updates happen against a stable view of state.
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
  // This avoids races where one operation mutates scope state while another
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

  async #closeTransaction(tx: TransactionWrapper, status: ClosingReason): Promise<void> {
    const createClosingPromise = async (scopesClosed: Promise<void>) => {
      debug('Closing transaction.', { transactionId: tx.id, status })
      try {
        await scopesClosed
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
      const scopesClosed = this.#closeScopes(tx.scopes, status)
      await Object.assign(tx, {
        status: 'closing',
        reason: status,
        closing: createClosingPromise(scopesClosed),
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
    })
  }
}

function innermostScope(tx: TransactionWrapper): Scope {
  return tx.scopes[tx.scopes.length - 1]
}

function closedTransactionError(
  tx: TransactionWrapper,
  reason: ClosingReason,
  operation: string,
): TransactionManagerError {
  switch (reason) {
    case 'committed':
      return new TransactionClosedError(operation)
    case 'rolled_back':
      return new TransactionRolledBackError(operation)
    case 'timed_out':
      return new TransactionExecutionTimeoutError(operation, {
        timeout: tx.timeout!,
        timeTaken: Date.now() - tx.startedAt,
      })
    default:
      return assertNever(reason, 'Unknown closing reason.')
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

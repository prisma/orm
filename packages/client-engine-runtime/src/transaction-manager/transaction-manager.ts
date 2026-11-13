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
  NestedTransactionRolledBackError,
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

type InterruptReason = Exclude<ClosingReason, 'committed'>

type ScopeClosingReason = ClosingReason | 'nested_rolled_back'

/**
 * One level of a transaction: the outermost transaction, or a nested transaction on top of it.
 * Handles from {@link TransactionManager.getTransaction} belong to the scope that was innermost
 * when they were issued. A committed nested transaction's scope is merged into its parent: its
 * running statements move there and its handles carry on there. A rolled back nested
 * transaction's scope stays closed; its running statements are counted in its parent until they
 * settle.
 */
type Scope = {
  savepoint: string | undefined
  closingReason?: ScopeClosingReason
  runningStatements: Set<Promise<void>>
  mergedInto?: Scope
}

function createScope(savepoint: string | undefined): Scope {
  return { savepoint, closingReason: undefined, runningStatements: new Set() }
}

function isNested(scope: Scope): scope is Scope & { savepoint: string } {
  return scope.savepoint !== undefined
}

function currentScope(scope: Scope): Scope {
  return scope.mergedInto ? currentScope(scope.mergedInto) : scope
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
  /** Resolves once the timeout or a disconnect has stopped any commit from waiting any longer. */
  commitInterrupted: Promise<InterruptReason>
  interruptCommit: (reason: InterruptReason) => void
} & TransactionState

type TransactionState =
  | { status: 'waiting' | 'running' | ClosingReason }
  | { status: 'closing'; closing: Promise<ClosingReason> }

function createCommitInterruption(): Pick<TransactionWrapper, 'commitInterrupted' | 'interruptCommit'> {
  let interruptCommit!: (reason: InterruptReason) => void
  const commitInterrupted = new Promise<InterruptReason>((resolve) => {
    interruptCommit = resolve
  })
  return { commitInterrupted, interruptCommit }
}

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
        ...createCommitInterruption(),
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
        if (isNested(scope)) {
          if (!txw.transaction) throw new TransactionNotFoundError()
          const outcome = await statementsSettledOrCommitInterrupted(txw, [...scope.runningStatements])
          if (outcome !== 'committed') {
            await this.#closeTransaction(txw, outcome)
            throw closedTransactionError(txw, outcome, 'commit')
          }
          try {
            await this.#releaseSavepoint(txw.transaction, scope.savepoint)
          } finally {
            mergeInnermostScope(txw)
          }
          return
        }
        const outcome = await this.#closeTransaction(txw, 'committed')
        if (outcome !== 'committed') throw closedTransactionError(txw, outcome, 'commit')
      })
    })
  }

  async rollbackTransaction(transactionId: string): Promise<void> {
    return await this.tracingHelper.runInChildSpan('rollback_transaction', async () => {
      await this.#withActiveTransactionLock(transactionId, 'rollback', async (txw) => {
        const scope = innermostScope(txw)
        if (isNested(scope)) {
          try {
            await this.#closeScopes(txw, [scope], 'nested_rolled_back')
            if (!txw.transaction) throw new TransactionNotFoundError()
            await this.#requiredRollbackToSavepoint(txw.transaction)(scope.savepoint)
            await this.#releaseSavepoint(txw.transaction, scope.savepoint)
          } finally {
            popRolledBackScope(txw)
          }
          return
        }
        await this.#closeTransaction(txw, 'rolled_back')
      })
    })
  }

  /**
   * Returns a handle for running statements in the transaction. The handle rejects every
   * statement issued after the transaction has started to close, or after the nested transaction
   * that is innermost now has started to roll back. A commit of that nested transaction never
   * closes the handle: it runs its statements in the enclosing transaction from then on,
   * including one issued while the commit waits to release the savepoint.
   */
  getTransaction(txInfo: TransactionInfo, operation: string): Promise<SqlQueryable> {
    return new Promise((resolve) => resolve(this.#issueHandle(txInfo, operation)))
  }

  #issueHandle(txInfo: TransactionInfo, operation: string): SqlQueryable {
    const tx = this.#getActiveOrClosingTransaction(txInfo.id, operation)
    const scope = innermostScope(tx)
    if (scope.closingReason !== undefined) throw closedTransactionError(tx, scope.closingReason, operation)
    if (!tx.transaction) throw new TransactionNotFoundError()
    return this.#guardedQueryable(tx, tx.transaction, scope, operation)
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
    issuedIn: Scope,
    operation: string,
    execute: () => Promise<T>,
  ): Promise<T> {
    const scope = currentScope(issuedIn)
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
      currentScope(issuedIn).runningStatements.delete(settled)
      markSettled()
    }
  }

  /**
   * Stops `scopes` from accepting statements, then waits for the ones already running. A commit
   * waits until they settle or the timeout or a disconnect interrupts it, and then becomes a
   * rollback. A rollback waits at most {@link ROLLBACK_GRACE_MS}. Resolves with how the
   * transaction is to be closed.
   */
  async #closeScopes<R extends ScopeClosingReason>(
    tx: TransactionWrapper,
    scopes: Scope[],
    reason: R,
  ): Promise<R | ClosingReason> {
    markClosing(scopes, reason)

    const running = scopes.flatMap((scope) => [...scope.runningStatements])
    if (running.length === 0) return reason

    let outcome: R | ClosingReason = reason
    if (reason === 'committed') {
      outcome = await statementsSettledOrCommitInterrupted(tx, running)
      if (outcome === 'committed') return outcome
      markClosing(scopes, outcome)
    }

    const allSettled = Promise.all(running).then(() => {})
    await settleWithin(allSettled, ROLLBACK_GRACE_MS)
    return outcome
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
    for (const tx of this.transactions.values()) {
      tx.interruptCommit('rolled_back')
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

        tx.interruptCommit('timed_out')
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

  /** Resolves with how the transaction was closed, which differs from `requested` for an interrupted commit. */
  async #closeTransaction(tx: TransactionWrapper, requested: ClosingReason): Promise<ClosingReason> {
    const createClosingPromise = async (scopesClosed: Promise<ClosingReason>) => {
      debug('Closing transaction.', { transactionId: tx.id, requested })
      const outcome = await scopesClosed
      try {
        if (tx.transaction && outcome === 'committed') {
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
        tx.status = outcome
        clearTimeout(tx.timer)
        tx.timer = undefined

        this.transactions.delete(tx.id)

        this.closedTransactions.push(tx)
        if (this.closedTransactions.length > MAX_CLOSED_TRANSACTIONS) {
          this.closedTransactions.shift()
        }
      }
      return outcome
    }

    if (tx.status === 'closing') {
      await tx.closing
      // Fetch again to ensure proper error propagation after it's been closed.
      this.#getActiveOrClosingTransaction(tx.id, requested === 'committed' ? 'commit' : 'rollback')
      throw new TransactionInternalConsistencyError('Transaction still active after it was closed.')
    }
    const scopesClosed = this.#closeScopes(tx, tx.scopes, requested)
    return await Object.assign(tx, {
      status: 'closing',
      closing: createClosingPromise(scopesClosed),
    }).closing
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

function innermostScope(tx: TransactionWrapper): Scope {
  return tx.scopes[tx.scopes.length - 1]
}

function popInnermostScope(tx: TransactionWrapper): { child: Scope; parent: Scope; moved: Promise<void>[] } {
  const child = innermostScope(tx)
  tx.scopes.pop()
  const parent = innermostScope(tx)
  const moved = [...child.runningStatements]
  for (const statement of moved) {
    parent.runningStatements.add(statement)
  }
  child.runningStatements.clear()
  return { child, parent, moved }
}

function mergeInnermostScope(tx: TransactionWrapper): void {
  const { child, parent } = popInnermostScope(tx)
  child.mergedInto = parent
}

function popRolledBackScope(tx: TransactionWrapper): void {
  const { parent, moved } = popInnermostScope(tx)
  for (const statement of moved) {
    void statement.then(() => currentScope(parent).runningStatements.delete(statement))
  }
}

function markClosing(scopes: Scope[], reason: ScopeClosingReason): void {
  for (const scope of scopes) {
    scope.closingReason = reason
  }
}

async function statementsSettledOrCommitInterrupted(
  tx: TransactionWrapper,
  running: Promise<void>[],
): Promise<ClosingReason> {
  if (running.length === 0) return 'committed'
  return await Promise.race([Promise.all(running).then(() => 'committed' as const), tx.commitInterrupted])
}

function closedTransactionError(
  tx: TransactionWrapper,
  reason: ScopeClosingReason,
  operation: string,
): TransactionManagerError {
  switch (reason) {
    case 'committed':
      return new TransactionClosedError(operation)
    case 'rolled_back':
      return new TransactionRolledBackError(operation)
    case 'nested_rolled_back':
      return new NestedTransactionRolledBackError(operation)
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

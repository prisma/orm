import timers from 'node:timers/promises'

import { expect, test, vi } from 'vitest'

import { noopTracingHelper } from '../tracing'
import {
  MockDriverAdapter,
  START_TRANSACTION_TIME,
  startTransaction,
  TRANSACTION_EXECUTION_TIMEOUT,
  TRANSACTION_OPTIONS,
} from './test-utils'
import { TransactionManager } from './transaction-manager'
import {
  InvalidTransactionIsolationLevelError,
  NestedTransactionRolledBackError,
  TransactionClosedError,
  TransactionExecutionTimeoutError,
  TransactionManagerError,
  TransactionNotFoundError,
  TransactionRolledBackError,
  TransactionStartTimeoutError,
} from './transaction-manager-error'

vi.useFakeTimers()

test('transaction executes normally', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  await transactionManager.commitTransaction(id)

  expect(driverAdapter.commitMock).toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('COMMIT')
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

  await expect(transactionManager.commitTransaction(id)).rejects.toBeInstanceOf(TransactionClosedError)
  await expect(transactionManager.rollbackTransaction(id)).rejects.toBeInstanceOf(TransactionClosedError)
})

test('nested commit only closes at the outermost level', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  const nested = await transactionManager.startTransaction({
    ...TRANSACTION_OPTIONS,
    newTxId: id,
  })

  expect(nested.id).toBe(id)

  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toMatch(/^SAVEPOINT prisma_sp_\d+$/)

  // Inner commit should not close the underlying transaction.
  await transactionManager.commitTransaction(id)
  expect(driverAdapter.commitMock).not.toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[1][0].sql).toMatch(/^RELEASE SAVEPOINT prisma_sp_\d+$/)

  // Outer commit closes.
  await transactionManager.commitTransaction(id)
  expect(driverAdapter.commitMock).toHaveBeenCalledTimes(1)
  expect(driverAdapter.executeRawMock.mock.calls[2][0].sql).toEqual('COMMIT')
})

test('nested rollback uses a savepoint and keeps the outer transaction open', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  await transactionManager.startTransaction({
    ...TRANSACTION_OPTIONS,
    newTxId: id,
  })

  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toMatch(/^SAVEPOINT prisma_sp_\d+$/)

  // Inner rollback should not close the underlying transaction.
  await transactionManager.rollbackTransaction(id)
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[1][0].sql).toMatch(/^ROLLBACK TO SAVEPOINT prisma_sp_\d+$/)
  expect(driverAdapter.executeRawMock.mock.calls[2][0].sql).toMatch(/^RELEASE SAVEPOINT prisma_sp_\d+$/)

  // Outer commit still closes.
  await transactionManager.commitTransaction(id)
  expect(driverAdapter.commitMock).toHaveBeenCalledTimes(1)
  expect(driverAdapter.executeRawMock.mock.calls[3][0].sql).toEqual('COMMIT')
})

test('nested starts are serialized when the first savepoint fails', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  let savepointCallCount = 0
  let rejectFirstSavepoint: ((error: Error) => void) | undefined
  let resolveFirstSavepointStarted: () => void
  const firstSavepointStarted = new Promise<void>((resolve) => {
    resolveFirstSavepointStarted = resolve
  })

  driverAdapter.executeRawMock.mockImplementation((query) => {
    if (query.sql.startsWith('SAVEPOINT ')) {
      savepointCallCount += 1
      if (savepointCallCount === 1) {
        resolveFirstSavepointStarted()
        return new Promise<number>((_, reject) => {
          rejectFirstSavepoint = reject
        })
      }
    }

    return Promise.resolve(1)
  })

  const nested1 = transactionManager.startTransaction({
    ...TRANSACTION_OPTIONS,
    newTxId: id,
  })
  const nested2 = transactionManager.startTransaction({
    ...TRANSACTION_OPTIONS,
    newTxId: id,
  })

  await firstSavepointStarted
  await Promise.resolve()
  expect(savepointCallCount).toBe(1)

  rejectFirstSavepoint?.(new Error('savepoint failed'))
  await expect(nested1).rejects.toThrow('savepoint failed')

  await expect(nested2).resolves.toEqual({ id })

  const savepointQueries = driverAdapter.executeRawMock.mock.calls
    .map((call) => call[0].sql)
    .filter((sql) => sql.startsWith('SAVEPOINT '))
  const successfulSavepointName = savepointQueries[1].slice('SAVEPOINT '.length)

  await transactionManager.rollbackTransaction(id)

  const rollbackToSavepointQuery = driverAdapter.executeRawMock.mock.calls
    .map((call) => call[0].sql)
    .find((sql) => sql.startsWith('ROLLBACK TO SAVEPOINT '))

  expect(rollbackToSavepointQuery).toEqual(`ROLLBACK TO SAVEPOINT ${successfulSavepointName}`)

  // Close top-level transaction.
  await transactionManager.rollbackTransaction(id)
})

test('nested savepoints use sqlserver syntax', async () => {
  const driverAdapter = new MockDriverAdapter({ provider: 'sqlserver' })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)
  await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })

  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toMatch(/^SAVE TRANSACTION prisma_sp_\d+$/)

  await transactionManager.rollbackTransaction(id)
  expect(driverAdapter.executeRawMock.mock.calls[1][0].sql).toMatch(/^ROLLBACK TRANSACTION prisma_sp_\d+$/)

  // No release savepoint query on SQL Server.
  expect(driverAdapter.executeRawMock.mock.calls).toHaveLength(2)
  await transactionManager.commitTransaction(id)
  expect(driverAdapter.executeRawMock.mock.calls[2][0].sql).toEqual('COMMIT')
})

test('nested savepoints use mysql syntax', async () => {
  const driverAdapter = new MockDriverAdapter({ provider: 'mysql' })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)
  await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })

  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toMatch(/^SAVEPOINT prisma_sp_\d+$/)

  await transactionManager.rollbackTransaction(id)
  expect(driverAdapter.executeRawMock.mock.calls[1][0].sql).toMatch(/^ROLLBACK TO prisma_sp_\d+$/)
  expect(driverAdapter.executeRawMock.mock.calls[2][0].sql).toMatch(/^RELEASE SAVEPOINT prisma_sp_\d+$/)

  await transactionManager.commitTransaction(id)
  expect(driverAdapter.executeRawMock.mock.calls[3][0].sql).toEqual('COMMIT')
})

test('nested savepoints use sqlite syntax', async () => {
  const driverAdapter = new MockDriverAdapter({ provider: 'sqlite' })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)
  await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })

  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toMatch(/^SAVEPOINT prisma_sp_\d+$/)

  await transactionManager.rollbackTransaction(id)
  expect(driverAdapter.executeRawMock.mock.calls[1][0].sql).toMatch(/^ROLLBACK TO prisma_sp_\d+$/)
  expect(driverAdapter.executeRawMock.mock.calls[2][0].sql).toMatch(/^RELEASE SAVEPOINT prisma_sp_\d+$/)

  await transactionManager.commitTransaction(id)
  expect(driverAdapter.executeRawMock.mock.calls[3][0].sql).toEqual('COMMIT')
})

test('nested savepoints use adapter-provided methods when available', async () => {
  const createSavepoint = vi.fn(async (_name: string) => {})
  const rollbackToSavepoint = vi.fn(async (_name: string) => {})
  const releaseSavepoint = vi.fn(async (_name: string) => {})

  const driverAdapter = new MockDriverAdapter({
    provider: 'postgres',
    createSavepoint,
    rollbackToSavepoint,
    releaseSavepoint,
  })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)
  await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })
  await transactionManager.rollbackTransaction(id)
  await transactionManager.commitTransaction(id)

  expect(createSavepoint).toHaveBeenCalledTimes(1)
  expect(rollbackToSavepoint).toHaveBeenCalledTimes(1)
  expect(releaseSavepoint).toHaveBeenCalledTimes(1)

  const savepointName = createSavepoint.mock.calls[0][0]
  expect(rollbackToSavepoint).toHaveBeenCalledWith(savepointName)
  expect(releaseSavepoint).toHaveBeenCalledWith(savepointName)
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('COMMIT')
})

test('nested savepoint release can be omitted by adapter', async () => {
  const createSavepoint = vi.fn(async () => {})

  const driverAdapter = new MockDriverAdapter({
    provider: 'postgres',
    createSavepoint,
    releaseSavepoint: undefined,
  })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)
  await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })
  await transactionManager.commitTransaction(id)
  await transactionManager.commitTransaction(id)

  expect(createSavepoint).toHaveBeenCalledTimes(1)
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('COMMIT')
})

test('missing createSavepoint fails nested transaction start', async () => {
  const driverAdapter = new MockDriverAdapter({ createSavepoint: undefined })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  await expect(transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })).rejects.toThrow(
    'createSavepoint is not implemented',
  )
})

test('missing rollbackToSavepoint fails nested rollback', async () => {
  const driverAdapter = new MockDriverAdapter({ rollbackToSavepoint: undefined })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)
  await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })
  const nested = await transactionManager.getTransaction({ id }, 'query')

  await expect(transactionManager.rollbackTransaction(id)).rejects.toThrow('rollbackToSavepoint is not implemented')

  await expect(nested.executeRaw({ sql: 'INSERT', args: [], argTypes: [] })).rejects.toEqual(
    new NestedTransactionRolledBackError('query'),
  )
  expect(driverAdapter.executeRawMock.mock.calls.map(([query]) => query.sql)).toEqual([
    expect.stringMatching(/^SAVEPOINT /),
  ])
})

test('transaction is rolled back', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  await transactionManager.rollbackTransaction(id)

  expect(driverAdapter.rollbackMock).toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('ROLLBACK')
  expect(driverAdapter.commitMock).not.toHaveBeenCalled()

  await expect(transactionManager.commitTransaction(id)).rejects.toBeInstanceOf(TransactionRolledBackError)
  await expect(transactionManager.rollbackTransaction(id)).rejects.toBeInstanceOf(TransactionRolledBackError)
})

test('rollbackTransaction in parallel raises a TransactionRolledBackError', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  const rollbackPromise1 = transactionManager.rollbackTransaction(id)
  const rollbackPromise2 = transactionManager.rollbackTransaction(id)
  await rollbackPromise1

  await expect(rollbackPromise2).rejects.toEqual(new TransactionRolledBackError('rollback'))

  expect(driverAdapter.rollbackMock).toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('ROLLBACK')
  expect(driverAdapter.commitMock).not.toHaveBeenCalled()
})

test('commitTransaction during a rollback caused by a time out raises a TransactionExecutionTimeoutError', async () => {
  const driverAdapter = new MockDriverAdapter()
  const timeout = 200
  const rollbackDelay = 200

  driverAdapter.rollbackMock = vi.fn().mockImplementation(() => timers.setTimeout(rollbackDelay))

  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: { timeout, maxWait: 1000 },
    tracingHelper: noopTracingHelper,
  })

  const txPromise = transactionManager.startTransaction()
  await vi.advanceTimersByTimeAsync(START_TRANSACTION_TIME + timeout)
  const tx = await txPromise
  const commitPromise = transactionManager.commitTransaction(tx.id)

  await expect(Promise.all([vi.advanceTimersByTimeAsync(rollbackDelay), commitPromise])).rejects.toEqual(
    new TransactionExecutionTimeoutError('commit', {
      // `START_TRANSACTION_TIME` is deliberately absent: the time reported is how long the
      // transaction itself ran, not how long it took to open.
      timeout,
      timeTaken: timeout + rollbackDelay,
    }),
  )

  expect(driverAdapter.rollbackMock).toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('ROLLBACK')
  expect(driverAdapter.commitMock).not.toHaveBeenCalled()
})

test('transactions are rolled back when shutting down', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id1 = await startTransaction(transactionManager)
  const id2 = await startTransaction(transactionManager)

  await transactionManager.cancelAllTransactions()

  expect(driverAdapter.rollbackMock).toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('ROLLBACK')
  expect(driverAdapter.executeRawMock.mock.calls[1][0].sql).toEqual('ROLLBACK')
  expect(driverAdapter.commitMock).not.toHaveBeenCalled()

  await expect(transactionManager.commitTransaction(id1)).rejects.toBeInstanceOf(TransactionRolledBackError)
  await expect(transactionManager.rollbackTransaction(id1)).rejects.toBeInstanceOf(TransactionRolledBackError)
  await expect(transactionManager.commitTransaction(id2)).rejects.toBeInstanceOf(TransactionRolledBackError)
  await expect(transactionManager.rollbackTransaction(id2)).rejects.toBeInstanceOf(TransactionRolledBackError)
})

test('when driver adapter requires phantom queries does not execute transaction statements', async () => {
  const driverAdapter = new MockDriverAdapter({ usePhantomQuery: true })
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  await transactionManager.commitTransaction(id)

  expect(driverAdapter.commitMock).toHaveBeenCalled()
  expect(driverAdapter.executeRawMock).not.toHaveBeenCalled()
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

  await expect(transactionManager.commitTransaction(id)).rejects.toBeInstanceOf(TransactionClosedError)
  await expect(transactionManager.rollbackTransaction(id)).rejects.toBeInstanceOf(TransactionClosedError)
})

test('with explicit isolation level', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager, { isolationLevel: 'SERIALIZABLE' })

  await transactionManager.commitTransaction(id)

  expect(driverAdapter.commitMock).toHaveBeenCalled()
  expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('COMMIT')
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

  await expect(transactionManager.commitTransaction(id)).rejects.toBeInstanceOf(TransactionClosedError)
  await expect(transactionManager.rollbackTransaction(id)).rejects.toBeInstanceOf(TransactionClosedError)
})

test('with isolation level only supported in MS SQL Server, "snapshot"', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  await expect(startTransaction(transactionManager, { isolationLevel: 'SNAPSHOT' })).rejects.toBeInstanceOf(
    InvalidTransactionIsolationLevelError,
  )
})

test('transaction times out during starting', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  await expect(startTransaction(transactionManager, { maxWait: START_TRANSACTION_TIME / 2 })).rejects.toBeInstanceOf(
    TransactionStartTimeoutError,
  )

  // The transaction start is still in progress when we time out.
  // Once it completes, it will be rolled back to avoid connection leaks.
  // At this point, it hasn't completed yet, so rollback hasn't been called.
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

  // Now let the startTransaction promise resolve
  await vi.advanceTimersByTimeAsync(START_TRANSACTION_TIME)

  // The transaction that was started in the background should now be rolled back
  // to release the connection back to the pool.
  expect(driverAdapter.rollbackMock).toHaveBeenCalled()
})

test('transaction start timeout cleans up connection if transaction eventually starts', async () => {
  // This test verifies that when maxWait timeout fires but startTransaction
  // eventually completes, we properly rollback to avoid leaking connections.

  const SLOW_START_TRANSACTION_TIME = 500
  const MAX_WAIT = 100
  const TIME_PAST_MAX_WAIT = MAX_WAIT + 50
  const REMAINING_TIME_FOR_START = SLOW_START_TRANSACTION_TIME - TIME_PAST_MAX_WAIT

  const rollbackMock = vi.fn().mockResolvedValue(undefined)
  const executeRawMock = vi.fn().mockResolvedValue(1)

  const driverAdapter = {
    adapterName: 'slow-adapter',
    provider: 'postgres' as const,
    executeRaw: vi.fn().mockResolvedValue(1),
    queryRaw: vi.fn(),
    executeScript: vi.fn(),
    dispose: vi.fn(),
    startTransaction: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                adapterName: 'slow-adapter',
                provider: 'postgres',
                options: { usePhantomQuery: false },
                queryRaw: vi.fn(),
                executeRaw: executeRawMock,
                commit: vi.fn(),
                rollback: rollbackMock,
              }),
            SLOW_START_TRANSACTION_TIME,
          ),
        ),
    ),
  }

  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: { timeout: TRANSACTION_EXECUTION_TIMEOUT, maxWait: MAX_WAIT },
    tracingHelper: noopTracingHelper,
  })

  // Start a transaction with a maxWait shorter than the actual connection time
  // Use Promise.all to advance timers and wait for the rejection simultaneously
  const [, txResult] = await Promise.all([
    vi.advanceTimersByTimeAsync(TIME_PAST_MAX_WAIT),
    transactionManager.startTransaction().catch((e) => e),
  ])

  // The transaction should have timed out
  expect(txResult).toBeInstanceOf(TransactionStartTimeoutError)

  // Rollback should not have been called yet because startTransaction hasn't completed
  expect(rollbackMock).not.toHaveBeenCalled()

  // Now advance time to let the startTransaction promise resolve
  await vi.advanceTimersByTimeAsync(REMAINING_TIME_FOR_START)

  // After the background startTransaction completes, the discarded transaction must send an
  // explicit ROLLBACK before releasing the connection. Without it, a non-phantom-query adapter
  // (e.g. pg/neon) returns a connection to the pool while it is still mid-transaction.
  expect(executeRawMock).toHaveBeenCalledWith(expect.objectContaining({ sql: 'ROLLBACK' }))
  expect(rollbackMock).toHaveBeenCalled()
})

test('transaction start failure clears the maxWait timer', async () => {
  const driverAdapter = new MockDriverAdapter()
  const startError = new Error('connection refused')
  vi.spyOn(driverAdapter, 'startTransaction').mockRejectedValue(startError)

  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  vi.clearAllTimers()

  await expect(transactionManager.startTransaction()).rejects.toBe(startError)

  // The maxWait timer must not outlive the failed startup attempt. No execution
  // timeout is armed either, because startup never reached the running state.
  expect(vi.getTimerCount()).toBe(0)
})

test('cancelAllTransactions waits for a transaction whose start is still in flight', async () => {
  // A transaction is only registered once the driver hands it over, so one that is still
  // starting is invisible to `cancelAllTransactions`. Callers dispose the driver adapter right
  // after cancelling, so if cancellation does not cover it the connection is abandoned.

  const SLOW_START_TRANSACTION_TIME = 500

  const rollbackMock = vi.fn().mockResolvedValue(undefined)
  const executeRawMock = vi.fn().mockResolvedValue(1)

  const driverAdapter = {
    adapterName: 'slow-adapter',
    provider: 'postgres' as const,
    executeRaw: vi.fn().mockResolvedValue(1),
    queryRaw: vi.fn(),
    executeScript: vi.fn(),
    dispose: vi.fn(),
    startTransaction: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                adapterName: 'slow-adapter',
                provider: 'postgres',
                options: { usePhantomQuery: false },
                queryRaw: vi.fn(),
                executeRaw: executeRawMock,
                commit: vi.fn(),
                rollback: rollbackMock,
              }),
            SLOW_START_TRANSACTION_TIME,
          ),
        ),
    ),
  }

  const transactionManager = new TransactionManager({
    driverAdapter,
    // `maxWait` is long enough that the start is still in flight, not timed out, when cancelled.
    transactionOptions: { timeout: TRANSACTION_EXECUTION_TIMEOUT, maxWait: SLOW_START_TRANSACTION_TIME * 10 },
    tracingHelper: noopTracingHelper,
  })

  const starting = transactionManager.startTransaction().catch((e) => e)

  // Let the start reach the driver, so the transaction is genuinely in flight when cancelled
  // rather than still waiting on its id.
  await vi.advanceTimersByTimeAsync(SLOW_START_TRANSACTION_TIME / 2)
  expect(driverAdapter.startTransaction).toHaveBeenCalled()

  let cancelled = false
  const cancelling = transactionManager.cancelAllTransactions().then(() => {
    cancelled = true
  })

  // Let any already-scheduled work run. The start is still in flight, so cancellation cannot
  // be finished yet.
  await vi.advanceTimersByTimeAsync(0)
  expect(cancelled).toBe(false)
  expect(rollbackMock).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(SLOW_START_TRANSACTION_TIME)
  await cancelling

  expect(cancelled).toBe(true)
  // The connection must be released before disposal, and an explicit ROLLBACK sent first,
  // because this adapter does not use phantom queries.
  expect(executeRawMock).toHaveBeenCalledWith(expect.objectContaining({ sql: 'ROLLBACK' }))
  expect(rollbackMock).toHaveBeenCalled()

  expect(await starting).toBeInstanceOf(TransactionStartTimeoutError)
})

test('cancelAllTransactions rolls back once when cancelling as the driver hands over', async () => {
  // Whichever of the driver and the abort wins the race, the transaction must be rolled back
  // exactly once. Releasing a pooled connection twice is worse than not releasing it at all.

  const rollbackMock = vi.fn().mockResolvedValue(undefined)
  const executeRawMock = vi.fn().mockResolvedValue(1)

  let resolveStart!: (tx: unknown) => void
  const startPromise = new Promise((resolve) => {
    resolveStart = resolve
  })

  const driverAdapter = {
    adapterName: 'manual-adapter',
    provider: 'postgres' as const,
    executeRaw: vi.fn().mockResolvedValue(1),
    queryRaw: vi.fn(),
    executeScript: vi.fn(),
    dispose: vi.fn(),
    startTransaction: vi.fn().mockImplementation(() => startPromise),
  }

  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: { timeout: TRANSACTION_EXECUTION_TIMEOUT, maxWait: START_TRANSACTION_TIME * 10 },
    tracingHelper: noopTracingHelper,
  })

  const starting = transactionManager.startTransaction().catch((e) => e)

  // Let the start reach the driver.
  await vi.advanceTimersByTimeAsync(0)
  expect(driverAdapter.startTransaction).toHaveBeenCalled()

  // Hand the transaction over, then cancel before the continuation gets to run: the abort loop
  // in `cancelAllTransactions` is synchronous, so it lands inside that window.
  resolveStart({
    adapterName: 'manual-adapter',
    provider: 'postgres',
    options: { usePhantomQuery: false },
    queryRaw: vi.fn(),
    executeRaw: executeRawMock,
    commit: vi.fn(),
    rollback: rollbackMock,
  })
  const cancelling = transactionManager.cancelAllTransactions()

  await vi.advanceTimersByTimeAsync(0)
  await cancelling

  expect(await starting).toBeInstanceOf(TransactionStartTimeoutError)
  expect(rollbackMock).toHaveBeenCalledTimes(1)
})

test('cancelAllTransactions gives up on a driver that never settles the start', async () => {
  // The rollback cannot run until the driver settles the promise it is holding. A driver stuck
  // on a dead connection never will, and disconnect must not wait on it forever.

  const driverAdapter = {
    adapterName: 'hanging-adapter',
    provider: 'postgres' as const,
    executeRaw: vi.fn(),
    queryRaw: vi.fn(),
    executeScript: vi.fn(),
    dispose: vi.fn(),
    startTransaction: vi.fn().mockImplementation(() => new Promise(() => {})),
  }

  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: { timeout: TRANSACTION_EXECUTION_TIMEOUT, maxWait: START_TRANSACTION_TIME },
    tracingHelper: noopTracingHelper,
  })

  void transactionManager.startTransaction().catch(() => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(driverAdapter.startTransaction).toHaveBeenCalled()

  let cancelled = false
  const cancelling = transactionManager.cancelAllTransactions().then(() => {
    cancelled = true
  })

  // Long past `maxWait`: nothing about the driver will ever change, so only the grace period
  // can release this.
  await vi.advanceTimersByTimeAsync(START_TRANSACTION_TIME * 4)
  expect(cancelled).toBe(false)

  await vi.advanceTimersByTimeAsync(2_000)
  await cancelling

  expect(cancelled).toBe(true)
})

test('cancelAllTransactions abandons a start that has not reached the driver yet', async () => {
  // Starting a transaction awaits its generated id before calling the driver. A cancellation
  // landing in that window must not go on to open a transaction that nobody will close.

  const driverAdapter = new MockDriverAdapter()
  const startTransactionSpy = vi.spyOn(driverAdapter, 'startTransaction')
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const starting = transactionManager.startTransaction().catch((e) => e)
  await transactionManager.cancelAllTransactions()

  await vi.advanceTimersByTimeAsync(START_TRANSACTION_TIME * 2)

  expect(await starting).toBeInstanceOf(TransactionStartTimeoutError)
  expect(startTransactionSpy).not.toHaveBeenCalled()
})

test('transaction times out during execution', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  const id = await startTransaction(transactionManager)

  await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT + 100)

  await expect(transactionManager.commitTransaction(id)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
  await expect(transactionManager.rollbackTransaction(id)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
})

test('execution timeout does not produce an unhandled rejection when rollback fails on a dead connection', async () => {
  // Regression test: when the database kills the backend connection before the execution timeout
  // fires, the timeout-driven ROLLBACK rejects. Since nothing awaits the timer callback's promise,
  // such a rejection used to escape as an unhandled rejection and crash the process outside the
  // user's try/catch around $transaction. The timer callback must therefore never reject.
  const originalSetTimeout = global.setTimeout
  const timerCallbackResults: Promise<unknown>[] = []
  const setTimeoutSpy = vi
    .spyOn(global, 'setTimeout')
    .mockImplementation((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
      return originalSetTimeout(
        (...cbArgs: any[]) => {
          const result = callback(...cbArgs) as unknown
          if (result instanceof Promise) {
            timerCallbackResults.push(result)
          }
        },
        ms,
        ...args,
      )
    })

  try {
    const driverAdapter = new MockDriverAdapter()
    const connectionError = new Error('Client has encountered a connection error and is not queryable')
    driverAdapter.executeRawMock = vi.fn().mockRejectedValue(connectionError)

    const transactionManager = new TransactionManager({
      driverAdapter,
      transactionOptions: TRANSACTION_OPTIONS,
      tracingHelper: noopTracingHelper,
    })

    const id = await startTransaction(transactionManager)

    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT + 100)

    expect(driverAdapter.executeRawMock).toHaveBeenCalled()
    expect(driverAdapter.executeRawMock.mock.calls[0][0].sql).toEqual('ROLLBACK')

    // No timer callback promise may reject: in production nothing awaits it, so a rejection
    // would surface as an unhandled rejection.
    const settledResults = await Promise.allSettled(timerCallbackResults)
    expect(settledResults.filter((result) => result.status === 'rejected')).toEqual([])

    // The transaction is still cleanly closed, so subsequent operations reject through the normal path.
    await expect(transactionManager.commitTransaction(id)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
    await expect(transactionManager.rollbackTransaction(id)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
  } finally {
    setTimeoutSpy.mockRestore()
  }
})

test('internal transaction does not apply the default start timeout', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: { ...TRANSACTION_OPTIONS, maxWait: START_TRANSACTION_TIME / 2 },
    tracingHelper: noopTracingHelper,
  })

  const [tx] = await Promise.all([
    transactionManager.startInternalTransaction(),
    vi.advanceTimersByTimeAsync(START_TRANSACTION_TIME),
  ])
  await transactionManager.commitTransaction(tx.id)

  expect(driverAdapter.commitMock).toHaveBeenCalled()
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()
})

test('internal transaction does not apply the default execution timeout', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: { ...TRANSACTION_OPTIONS, timeout: TRANSACTION_EXECUTION_TIMEOUT / 2 },
    tracingHelper: noopTracingHelper,
  })

  const [tx] = await Promise.all([
    transactionManager.startInternalTransaction(),
    vi.advanceTimersByTimeAsync(START_TRANSACTION_TIME),
  ])
  await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT)
  await transactionManager.commitTransaction(tx.id)

  expect(driverAdapter.commitMock).toHaveBeenCalled()
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()
})

test('trying to commit or rollback invalid transaction id fails with TransactionNotFoundError', async () => {
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  await expect(transactionManager.commitTransaction('invalid-tx-id')).rejects.toBeInstanceOf(TransactionNotFoundError)
  await expect(transactionManager.rollbackTransaction('invalid-tx-id')).rejects.toBeInstanceOf(TransactionNotFoundError)

  expect(driverAdapter.executeRawMock).not.toHaveBeenCalled()
  expect(driverAdapter.commitMock).not.toHaveBeenCalled()
  expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()
})

test('TransactionManagerErrors have common structure', () => {
  const error = new TransactionManagerError('test message', { foo: 'bar' })

  expect(error.code).toEqual('P2028')
  expect(error.message).toEqual('Transaction API error: test message')
  expect(error.meta).toEqual({ foo: 'bar' })
})

test('startTransaction works when setTimeout returns a timer without unref (workerd environment)', async () => {
  const originalSetTimeout = global.setTimeout
  const setTimeoutSpy = vi
    .spyOn(global, 'setTimeout')
    .mockImplementation((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
      const timer = originalSetTimeout(callback, ms, ...args)
      // @ts-expect-error
      timer.unref = undefined
      return timer
    })
  const driverAdapter = new MockDriverAdapter()
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })

  // This should not throw, even though the timer has no unref
  const id = await startTransaction(transactionManager)
  await transactionManager.commitTransaction(id)

  setTimeoutSpy.mockRestore()
})

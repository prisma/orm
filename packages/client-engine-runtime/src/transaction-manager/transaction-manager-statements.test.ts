import type { SqlQuery, Transaction } from '@prisma/driver-adapter-utils'
import { describe, expect, test, vi } from 'vitest'

import { noopTracingHelper } from '../tracing'
import {
  deferred,
  EMPTY_RESULT_SET,
  MockDriverAdapter,
  startTransaction,
  TRANSACTION_EXECUTION_TIMEOUT,
  TRANSACTION_OPTIONS,
} from './test-utils'
import { TransactionManager } from './transaction-manager'
import {
  NestedTransactionRolledBackError,
  TransactionClosedError,
  TransactionExecutionTimeoutError,
  TransactionRolledBackError,
  TransactionStartTimeoutError,
} from './transaction-manager-error'

vi.useFakeTimers()

const ROLLBACK_GRACE_MS = 2_000
const LONG_TIMEOUT = 60_000

const INSERT: SqlQuery = { sql: 'INSERT', args: [], argTypes: [] }
const UPDATE: SqlQuery = { sql: 'UPDATE', args: [], argTypes: [] }

function setup(options: ConstructorParameters<typeof MockDriverAdapter>[0] = {}) {
  const driverAdapter = new MockDriverAdapter(options)
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })
  return { driverAdapter, transactionManager }
}

function sentSql(driverAdapter: MockDriverAdapter): string[] {
  return driverAdapter.executeRawMock.mock.calls.map(([query]) => query.sql)
}

/**
 * Makes the adapter hold every `INSERT` open until the returned deferred settles. Other
 * statements succeed at once.
 */
function holdInserts(driverAdapter: MockDriverAdapter) {
  const insert = deferred<number>()
  driverAdapter.executeRawMock.mockImplementation((query) =>
    query.sql === INSERT.sql ? insert.promise : Promise.resolve(1),
  )
  return insert
}

function trackSettled(promise: Promise<unknown>) {
  const state = { settled: false }
  promise.then(
    () => {
      state.settled = true
    },
    () => {
      state.settled = true
    },
  )
  return state
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('statements through a transaction handle', () => {
  test('carry the adapter identity', async () => {
    const { transactionManager } = setup()
    const id = await startTransaction(transactionManager)

    const handle = await transactionManager.getTransaction({ id }, 'query')

    expect({ provider: handle.provider, adapterName: handle.adapterName }).toEqual({
      provider: 'postgres',
      adapterName: 'mock-adapter',
    })
    await expect(handle.queryRaw(INSERT)).resolves.toEqual(EMPTY_RESULT_SET)
    await expect(handle.executeRaw(INSERT)).resolves.toBe(1)
  })

  test('are rejected after commit and never reach the adapter', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')

    await transactionManager.commitTransaction(id)

    await expect(handle.executeRaw(INSERT)).rejects.toEqual(new TransactionClosedError('query'))
    await expect(handle.queryRaw(INSERT)).rejects.toEqual(new TransactionClosedError('query'))
    expect(sentSql(driverAdapter)).toEqual(['COMMIT'])
    expect(driverAdapter.queryRawMock).not.toHaveBeenCalled()
  })

  test('are rejected after rollback and never reach the adapter', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'batch query')

    await transactionManager.rollbackTransaction(id)

    await expect(handle.executeRaw(INSERT)).rejects.toEqual(new TransactionRolledBackError('batch query'))
    expect(sentSql(driverAdapter)).toEqual(['ROLLBACK'])
  })

  test('are rejected after a timeout and never reach the adapter', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')

    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT + 100)

    await expect(handle.executeRaw(INSERT)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
    expect(sentSql(driverAdapter)).toEqual(['ROLLBACK'])
  })

  test('are rejected after disconnect and never reach the adapter', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')

    await transactionManager.cancelAllTransactions()

    await expect(handle.executeRaw(INSERT)).rejects.toEqual(new TransactionRolledBackError('query'))
    expect(sentSql(driverAdapter)).toEqual(['ROLLBACK'])
  })
})

describe.each([
  { usePhantomQuery: false, commitSql: ['COMMIT'], rollbackSql: ['ROLLBACK'] },
  { usePhantomQuery: true, commitSql: [], rollbackSql: [] },
])(
  'closing while a statement is running (usePhantomQuery: $usePhantomQuery)',
  ({ usePhantomQuery, commitSql, rollbackSql }) => {
    test('commit sends nothing until the statement settles and rejects statements sent meanwhile', async () => {
      const { driverAdapter, transactionManager } = setup({ usePhantomQuery })
      const id = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
      const handle = await transactionManager.getTransaction({ id }, 'query')
      const insert = holdInserts(driverAdapter)

      const running = handle.executeRaw(INSERT)
      const committing = transactionManager.commitTransaction(id)
      await flush()

      await expect(handle.executeRaw(UPDATE)).rejects.toEqual(new TransactionClosedError('query'))
      expect(sentSql(driverAdapter)).toEqual(['INSERT'])
      expect(driverAdapter.commitMock).not.toHaveBeenCalled()

      insert.resolve(1)
      await expect(running).resolves.toBe(1)
      await committing

      expect(sentSql(driverAdapter)).toEqual(['INSERT', ...commitSql])
      expect(driverAdapter.commitMock).toHaveBeenCalledTimes(1)
      expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()
    })

    test('rollback sends nothing until the statement settles and rejects statements sent meanwhile', async () => {
      const { driverAdapter, transactionManager } = setup({ usePhantomQuery })
      const id = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
      const handle = await transactionManager.getTransaction({ id }, 'query')
      const insert = holdInserts(driverAdapter)

      const running = handle.queryRaw(UPDATE).then(() => handle.executeRaw(INSERT))
      await flush()
      const rollingBack = transactionManager.rollbackTransaction(id)
      await flush()

      await expect(handle.queryRaw(UPDATE)).rejects.toEqual(new TransactionRolledBackError('query'))
      expect(sentSql(driverAdapter)).toEqual(['INSERT'])
      expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

      insert.resolve(1)
      await expect(running).resolves.toBe(1)
      await rollingBack

      expect(sentSql(driverAdapter)).toEqual(['INSERT', ...rollbackSql])
      expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
      expect(driverAdapter.queryRawMock).toHaveBeenCalledTimes(1)
    })
  },
)

describe('a statement that never settles', () => {
  test('holds up a rollback for at most the grace period', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
    const handle = await transactionManager.getTransaction({ id }, 'query')
    holdInserts(driverAdapter)

    void handle.executeRaw(INSERT)
    const rollingBack = trackSettled(transactionManager.rollbackTransaction(id))

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS - 1)
    expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'ROLLBACK'])
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
    expect(rollingBack.settled).toBe(true)
  })

  test('holds up a timeout for at most the grace period', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')
    holdInserts(driverAdapter)

    void handle.executeRaw(INSERT)

    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT)
    await expect(handle.executeRaw(UPDATE)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS / 2)
    expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS / 2)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'ROLLBACK'])
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
  })

  test('holds up disconnect for at most the grace period', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
    const handle = await transactionManager.getTransaction({ id }, 'query')
    holdInserts(driverAdapter)

    void handle.executeRaw(INSERT)
    const cancelling = trackSettled(transactionManager.cancelAllTransactions())

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS - 1)
    expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
    expect(cancelling.settled).toBe(true)
  })

  test('holds up a commit until it settles', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
    const handle = await transactionManager.getTransaction({ id }, 'query')
    const insert = holdInserts(driverAdapter)

    void handle.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS * 5)
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()

    insert.resolve(1)
    await committing
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'COMMIT'])
  })
})

describe('a commit waiting for a running statement', () => {
  test('is rolled back when the timeout fires', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')
    holdInserts(driverAdapter)

    void handle.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    const commitState = trackSettled(committing)

    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT)
    await expect(handle.executeRaw(UPDATE)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
    await expect(transactionManager.getTransaction({ id }, 'query')).rejects.toBeInstanceOf(
      TransactionExecutionTimeoutError,
    )

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
    expect(commitState.settled).toBe(true)
    await expect(committing).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'ROLLBACK'])
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()
  })

  test('is rolled back on disconnect', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
    const handle = await transactionManager.getTransaction({ id }, 'query')
    holdInserts(driverAdapter)

    void handle.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    const commitState = trackSettled(committing)
    await flush()
    const cancelling = trackSettled(transactionManager.cancelAllTransactions())
    await flush()

    await expect(handle.executeRaw(UPDATE)).rejects.toEqual(new TransactionRolledBackError('query'))

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
    expect(cancelling.settled).toBe(true)
    expect(commitState.settled).toBe(true)
    await expect(committing).rejects.toEqual(new TransactionRolledBackError('commit'))
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'ROLLBACK'])
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()
  })

  test('commits when the statement settles before the timeout', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')
    const insert = holdInserts(driverAdapter)

    const running = handle.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT / 10)
    insert.resolve(1)

    await expect(running).resolves.toBe(1)
    await expect(committing).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'COMMIT'])
    expect(driverAdapter.commitMock).toHaveBeenCalledTimes(1)
    expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()
  })

  test('is rolled back without sending SQL when the adapter uses phantom queries', async () => {
    const { driverAdapter, transactionManager } = setup({ usePhantomQuery: true })
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')
    holdInserts(driverAdapter)

    void handle.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    const commitState = trackSettled(committing)

    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT + ROLLBACK_GRACE_MS)
    expect(commitState.settled).toBe(true)
    await expect(committing).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()
  })
})

describe('nested transactions', () => {
  async function startNested(options: { timeout?: number; releaseSavepoint?: (name: string) => Promise<void> } = {}) {
    const { timeout = LONG_TIMEOUT, ...adapterOptions } = options
    const { driverAdapter, transactionManager } = setup(adapterOptions)
    const id = await startTransaction(transactionManager, { timeout })
    const outer = await transactionManager.getTransaction({ id }, 'query')
    await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })
    const inner = await transactionManager.getTransaction({ id }, 'query')
    driverAdapter.executeRawMock.mockClear()
    return { driverAdapter, transactionManager, id, outer, inner }
  }

  test('a handle from a rolled back nested transaction is rejected while the outer one still works', async () => {
    const { driverAdapter, transactionManager, id, outer, inner } = await startNested()

    await transactionManager.rollbackTransaction(id)

    await expect(inner.executeRaw(INSERT)).rejects.toEqual(new NestedTransactionRolledBackError('query'))
    await expect(outer.executeRaw(UPDATE)).resolves.toBe(1)
    expect(sentSql(driverAdapter)).toEqual([
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
      'UPDATE',
    ])
  })

  test('a handle from an open nested transaction reports the whole transaction rolled back on disconnect', async () => {
    const { transactionManager, inner } = await startNested()

    await transactionManager.cancelAllTransactions()

    await expect(inner.executeRaw(INSERT)).rejects.toEqual(new TransactionRolledBackError('query'))
  })

  test('getTransaction is refused while a nested rollback waits for a running statement', async () => {
    const { driverAdapter, transactionManager, id } = await startNested()
    const inner = await transactionManager.getTransaction({ id }, 'query')
    holdInserts(driverAdapter)

    void inner.executeRaw(INSERT)
    const rollingBack = transactionManager.rollbackTransaction(id)
    await flush()

    await expect(transactionManager.getTransaction({ id }, 'query')).rejects.toEqual(
      new NestedTransactionRolledBackError('query'),
    )
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
    await rollingBack
  })

  test('a commit queued behind a nested rollback when the timeout fires still commits if no statement is running', async () => {
    const { driverAdapter, transactionManager, id } = await startNested({ timeout: TRANSACTION_EXECUTION_TIMEOUT })
    const rollbackToSavepoint = deferred<number>()
    driverAdapter.executeRawMock.mockImplementation((query) =>
      query.sql.startsWith('ROLLBACK TO SAVEPOINT') ? rollbackToSavepoint.promise : Promise.resolve(1),
    )

    const rollingBack = transactionManager.rollbackTransaction(id)
    const committing = transactionManager.commitTransaction(id)
    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT)
    rollbackToSavepoint.resolve(1)

    await rollingBack
    await expect(committing).resolves.toBeUndefined()
    expect(sentSql(driverAdapter)).toEqual([
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
      'COMMIT',
    ])
    expect(driverAdapter.commitMock).toHaveBeenCalledTimes(1)
    expect(driverAdapter.rollbackMock).not.toHaveBeenCalled()
  })

  test('a handle from a committed nested transaction keeps working in the outer transaction', async () => {
    const { driverAdapter, transactionManager, id, outer, inner } = await startNested()

    await transactionManager.commitTransaction(id)

    await expect(inner.executeRaw(INSERT)).resolves.toBe(1)
    await expect(outer.executeRaw(UPDATE)).resolves.toBe(1)
    expect(sentSql(driverAdapter)).toEqual([expect.stringMatching(/^RELEASE SAVEPOINT /), 'INSERT', 'UPDATE'])
  })

  test('the outer commit waits for a statement sent through a committed nested transaction', async () => {
    const { driverAdapter, transactionManager, id, inner } = await startNested()
    await transactionManager.commitTransaction(id)
    const insert = holdInserts(driverAdapter)

    const running = inner.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS * 5)
    expect(sentSql(driverAdapter)).toEqual([expect.stringMatching(/^RELEASE SAVEPOINT /), 'INSERT'])
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()

    insert.resolve(1)
    await expect(running).resolves.toBe(1)
    await committing
    expect(sentSql(driverAdapter)).toEqual([expect.stringMatching(/^RELEASE SAVEPOINT /), 'INSERT', 'COMMIT'])
  })

  test('a statement sent while a nested commit waits counts as running in the outer transaction', async () => {
    const { driverAdapter, transactionManager, id, inner } = await startNested()
    const insert = deferred<number>()
    const update = deferred<number>()
    driverAdapter.executeRawMock.mockImplementation((query) =>
      query.sql === INSERT.sql ? insert.promise : query.sql === UPDATE.sql ? update.promise : Promise.resolve(1),
    )

    const inserting = inner.executeRaw(INSERT)
    const nestedCommit = transactionManager.commitTransaction(id)
    await flush()
    const updating = inner.executeRaw(UPDATE)
    insert.resolve(1)
    await nestedCommit

    const outerCommit = transactionManager.commitTransaction(id)
    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS * 5)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'UPDATE', expect.stringMatching(/^RELEASE SAVEPOINT /)])
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()

    update.resolve(1)
    await expect(Promise.all([inserting, updating])).resolves.toEqual([1, 1])
    await outerCommit
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'UPDATE', expect.stringMatching(/^RELEASE SAVEPOINT /), 'COMMIT'])
  })

  test('handles from every level are rejected once the outer transaction closes', async () => {
    const { transactionManager, id, outer, inner } = await startNested()
    const committed = new TransactionClosedError('query')

    await transactionManager.commitTransaction(id)
    await transactionManager.commitTransaction(id)

    await expect(inner.executeRaw(INSERT)).rejects.toEqual(committed)
    await expect(outer.executeRaw(INSERT)).rejects.toEqual(committed)
  })

  test('a handle from a committed nested transaction is rejected once the outer transaction rolls back', async () => {
    const { transactionManager, id, inner } = await startNested()

    await transactionManager.commitTransaction(id)
    await transactionManager.rollbackTransaction(id)

    await expect(inner.executeRaw(INSERT)).rejects.toEqual(new TransactionRolledBackError('query'))
  })

  test('a handle from a committed nested transaction is rejected once the outer transaction times out', async () => {
    const { transactionManager, id, inner } = await startNested({ timeout: TRANSACTION_EXECUTION_TIMEOUT })

    await transactionManager.commitTransaction(id)
    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT)

    await expect(inner.executeRaw(INSERT)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
  })

  test('a handle from a nested transaction two levels deep runs in the outer transaction once both commit', async () => {
    const { driverAdapter, transactionManager, id } = await startNested()
    await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })
    const innermost = await transactionManager.getTransaction({ id }, 'query')
    await transactionManager.commitTransaction(id)
    await transactionManager.commitTransaction(id)
    driverAdapter.executeRawMock.mockClear()
    const insert = holdInserts(driverAdapter)

    const running = innermost.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS * 5)
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()

    insert.resolve(1)
    await expect(running).resolves.toBe(1)
    await committing
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'COMMIT'])
  })

  test('a nested commit whose savepoint release fails still leaves the outer transaction usable', async () => {
    const failure = new Error('release failed')
    const { driverAdapter, transactionManager, id, outer, inner } = await startNested({
      releaseSavepoint: () => Promise.reject(failure),
    })

    await expect(transactionManager.commitTransaction(id)).rejects.toBe(failure)

    await expect(inner.executeRaw(INSERT)).resolves.toBe(1)
    await expect(outer.executeRaw(UPDATE)).resolves.toBe(1)
    await transactionManager.commitTransaction(id)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'UPDATE', 'COMMIT'])
    expect(driverAdapter.commitMock).toHaveBeenCalledTimes(1)
  })

  test('a nested commit waiting for a running statement gives way to disconnect', async () => {
    const { driverAdapter, transactionManager, id, outer, inner } = await startNested()
    holdInserts(driverAdapter)

    void inner.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    const commitState = trackSettled(committing)
    await flush()
    const cancelling = trackSettled(transactionManager.cancelAllTransactions())
    await flush()

    await expect(outer.executeRaw(UPDATE)).rejects.toEqual(new TransactionRolledBackError('query'))

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
    expect(cancelling.settled).toBe(true)
    expect(commitState.settled).toBe(true)
    await expect(committing).rejects.toEqual(new TransactionRolledBackError('commit'))
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'ROLLBACK'])
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()
  })

  test('a nested commit waits for its running statement before releasing the savepoint', async () => {
    const { driverAdapter, transactionManager, id, inner } = await startNested()
    const insert = holdInserts(driverAdapter)

    const running = inner.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS * 5)
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])

    insert.resolve(1)
    await running
    await committing
    expect(sentSql(driverAdapter)).toEqual(['INSERT', expect.stringMatching(/^RELEASE SAVEPOINT /)])
  })

  test('a nested commit waiting for a running statement gives way to the timeout', async () => {
    const { driverAdapter, transactionManager, id, outer, inner } = await startNested({
      timeout: TRANSACTION_EXECUTION_TIMEOUT,
    })
    holdInserts(driverAdapter)

    void inner.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)
    const commitState = trackSettled(committing)

    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT)
    await expect(outer.executeRaw(UPDATE)).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
    expect(commitState.settled).toBe(true)
    await expect(committing).rejects.toBeInstanceOf(TransactionExecutionTimeoutError)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'ROLLBACK'])
    expect(driverAdapter.rollbackMock).toHaveBeenCalledTimes(1)
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()
  })

  test('a nested rollback waits for its running statement for at most the grace period', async () => {
    const { driverAdapter, transactionManager, id, inner } = await startNested()
    holdInserts(driverAdapter)

    void inner.executeRaw(INSERT)
    const rollingBack = trackSettled(transactionManager.rollbackTransaction(id))

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS - 1)
    await expect(inner.executeRaw(UPDATE)).rejects.toEqual(new NestedTransactionRolledBackError('query'))
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])

    await vi.advanceTimersByTimeAsync(1)
    expect(sentSql(driverAdapter)).toEqual([
      'INSERT',
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
    ])
    expect(rollingBack.settled).toBe(true)
  })

  test('the outer commit waits for a statement that outlived a nested rollback', async () => {
    const { driverAdapter, transactionManager, id, inner } = await startNested()
    const insert = holdInserts(driverAdapter)

    const running = inner.executeRaw(INSERT)
    const rollingBack = transactionManager.rollbackTransaction(id)
    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
    await rollingBack

    const committing = transactionManager.commitTransaction(id)
    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS * 5)
    await expect(inner.executeRaw(UPDATE)).rejects.toEqual(new NestedTransactionRolledBackError('query'))
    expect(driverAdapter.commitMock).not.toHaveBeenCalled()

    insert.resolve(1)
    await expect(running).resolves.toBe(1)
    await committing
    expect(sentSql(driverAdapter)).toEqual([
      'INSERT',
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
      'COMMIT',
    ])
  })

  test('a nested close does not wait for a statement from the outer transaction', async () => {
    const { driverAdapter, transactionManager, id, outer } = await startNested()
    const insert = holdInserts(driverAdapter)

    const running = outer.executeRaw(INSERT)
    await transactionManager.commitTransaction(id)

    expect(sentSql(driverAdapter)).toEqual(['INSERT', expect.stringMatching(/^RELEASE SAVEPOINT /)])
    insert.resolve(1)
    await expect(running).resolves.toBe(1)
  })
})

test('getTransaction on a closing transaction throws without waiting for the close', async () => {
  const { driverAdapter, transactionManager } = setup()
  const id = await startTransaction(transactionManager)
  const commit = deferred<void>()
  driverAdapter.commitMock.mockReturnValue(commit.promise)

  const committing = transactionManager.commitTransaction(id)
  await flush()

  const gettingTransaction = transactionManager.getTransaction({ id }, 'query')
  const state = trackSettled(gettingTransaction)
  await flush()

  expect(state.settled).toBe(true)
  await expect(gettingTransaction).rejects.toEqual(new TransactionClosedError('query'))

  commit.resolve()
  await committing
})

test('a close completes when the running statement rejects', async () => {
  const { driverAdapter, transactionManager } = setup()
  const id = await startTransaction(transactionManager)
  const handle = await transactionManager.getTransaction({ id }, 'query')
  const insert = holdInserts(driverAdapter)
  const failure = new Error('statement failed')

  const running = handle.executeRaw(INSERT)
  const committing = transactionManager.commitTransaction(id)
  insert.reject(failure)

  await expect(running).rejects.toBe(failure)
  await committing
  expect(sentSql(driverAdapter)).toEqual(['INSERT', 'COMMIT'])
})

test('a close completes when the adapter throws synchronously', async () => {
  const { driverAdapter, transactionManager } = setup()
  const id = await startTransaction(transactionManager)
  const handle = await transactionManager.getTransaction({ id }, 'query')
  const failure = new Error('thrown synchronously')
  driverAdapter.queryRawMock.mockImplementation(() => {
    throw failure
  })

  await expect(handle.queryRaw(INSERT)).rejects.toBe(failure)

  const committing = trackSettled(transactionManager.commitTransaction(id))
  await flush()
  expect(committing.settled).toBe(true)
  expect(driverAdapter.commitMock).toHaveBeenCalledTimes(1)
})

describe.each([
  { first: 'commit', delayBeforeClosing: 0, commitError: TransactionRolledBackError },
  {
    first: 'the timeout',
    delayBeforeClosing: TRANSACTION_EXECUTION_TIMEOUT,
    commitError: TransactionExecutionTimeoutError,
  },
])('when $first comes first', ({ delayBeforeClosing, commitError }) => {
  test('the adapter transaction is closed once when commit, rollback, timeout and disconnect race', async () => {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager)
    const handle = await transactionManager.getTransaction({ id }, 'query')
    const insert = holdInserts(driverAdapter)

    void handle.executeRaw(INSERT).catch(() => {})
    await vi.advanceTimersByTimeAsync(delayBeforeClosing)
    const closes = Promise.allSettled([
      transactionManager.commitTransaction(id),
      transactionManager.rollbackTransaction(id),
      transactionManager.cancelAllTransactions(),
    ])

    await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT + ROLLBACK_GRACE_MS)
    insert.resolve(1)
    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
    const [commitOutcome] = await closes

    expect(commitOutcome).toMatchObject({ status: 'rejected', reason: expect.any(commitError) })
    expect(driverAdapter.commitMock.mock.calls.length + driverAdapter.rollbackMock.mock.calls.length).toBe(1)
    expect(sentSql(driverAdapter)).toEqual(['INSERT', 'ROLLBACK'])
  })
})

test('disconnect rolls back a starting, a running and a commit-waiting transaction, closing each once', async () => {
  const { driverAdapter, transactionManager } = setup()
  const startedTransactions: Transaction[] = []
  const startAdapterTransaction = driverAdapter.startTransaction.bind(driverAdapter)
  const startAdapterTransactionSpy = vi.spyOn(driverAdapter, 'startTransaction').mockImplementation(async () => {
    const transaction = await startAdapterTransaction()
    startedTransactions.push(transaction)
    return transaction
  })

  const running = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
  const committingId = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
  const handle = await transactionManager.getTransaction({ id: committingId }, 'query')
  holdInserts(driverAdapter)
  void handle.executeRaw(INSERT)
  const committing = transactionManager.commitTransaction(committingId)
  const starting = transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, timeout: LONG_TIMEOUT })
  await flush()
  expect(startAdapterTransactionSpy).toHaveBeenCalledTimes(3)

  const cancelling = transactionManager.cancelAllTransactions()
  const outcomes = Promise.allSettled([committing, starting])
  await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)

  await expect(cancelling).resolves.toBeUndefined()
  expect(await outcomes).toEqual([
    { status: 'rejected', reason: new TransactionRolledBackError('commit') },
    { status: 'rejected', reason: new TransactionStartTimeoutError() },
  ])
  await expect(transactionManager.commitTransaction(running)).rejects.toEqual(new TransactionRolledBackError('commit'))
  expect(startedTransactions).toHaveLength(3)
  expect(
    startedTransactions.map((transaction) =>
      driverAdapter.rollbackMock.mock.contexts.filter((context) => context === transaction),
    ),
  ).toEqual(startedTransactions.map((transaction) => [transaction]))
  expect(driverAdapter.commitMock).not.toHaveBeenCalled()
})

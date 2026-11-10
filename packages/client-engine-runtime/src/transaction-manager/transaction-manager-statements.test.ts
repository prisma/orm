import type { SqlQuery } from '@prisma/driver-adapter-utils'
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
  TransactionClosedError,
  TransactionExecutionTimeoutError,
  TransactionRolledBackError,
} from './transaction-manager-error'

vi.useFakeTimers()

const ROLLBACK_GRACE_MS = 2_000
const LONG_TIMEOUT = 60_000

const INSERT: SqlQuery = { sql: 'INSERT', args: [], argTypes: [] }
const UPDATE: SqlQuery = { sql: 'UPDATE', args: [], argTypes: [] }

function setup(options: { usePhantomQuery?: boolean } = {}) {
  const driverAdapter = new MockDriverAdapter(options)
  const transactionManager = new TransactionManager({
    driverAdapter,
    transactionOptions: TRANSACTION_OPTIONS,
    tracingHelper: noopTracingHelper,
  })
  return { driverAdapter, transactionManager }
}

function sentSql(driverAdapter: MockDriverAdapter): string[] {
  return driverAdapter.executeRawMock.mock.calls.map(([query]: [SqlQuery]) => query.sql)
}

/**
 * Makes the adapter hold every `INSERT` open until the returned deferred settles. Other
 * statements succeed at once.
 */
function holdInserts(driverAdapter: MockDriverAdapter) {
  const insert = deferred<number>()
  driverAdapter.executeRawMock.mockImplementation((query: SqlQuery) =>
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

describe('nested transactions', () => {
  async function startNested() {
    const { driverAdapter, transactionManager } = setup()
    const id = await startTransaction(transactionManager, { timeout: LONG_TIMEOUT })
    const outer = await transactionManager.getTransaction({ id }, 'query')
    await transactionManager.startTransaction({ ...TRANSACTION_OPTIONS, newTxId: id })
    const inner = await transactionManager.getTransaction({ id }, 'query')
    driverAdapter.executeRawMock.mockClear()
    return { driverAdapter, transactionManager, id, outer, inner }
  }

  test('a handle from a rolled back nested transaction is rejected while the outer one still works', async () => {
    const { driverAdapter, transactionManager, id, outer, inner } = await startNested()

    await transactionManager.rollbackTransaction(id)

    await expect(inner.executeRaw(INSERT)).rejects.toEqual(new TransactionRolledBackError('query'))
    await expect(outer.executeRaw(UPDATE)).resolves.toBe(1)
    expect(sentSql(driverAdapter)).toEqual([
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
      'UPDATE',
    ])
  })

  test('a handle from a committed nested transaction is rejected while the outer one still works', async () => {
    const { driverAdapter, transactionManager, id, outer, inner } = await startNested()

    await transactionManager.commitTransaction(id)

    await expect(inner.executeRaw(INSERT)).rejects.toEqual(new TransactionClosedError('query'))
    await expect(outer.executeRaw(UPDATE)).resolves.toBe(1)
    expect(sentSql(driverAdapter)).toEqual([expect.stringMatching(/^RELEASE SAVEPOINT /), 'UPDATE'])
  })

  test('handles from every level are rejected once the outer transaction closes', async () => {
    const { transactionManager, id, outer, inner } = await startNested()
    const committed = new TransactionClosedError('query')

    await transactionManager.commitTransaction(id)
    await transactionManager.commitTransaction(id)

    await expect(inner.executeRaw(INSERT)).rejects.toEqual(committed)
    await expect(outer.executeRaw(INSERT)).rejects.toEqual(committed)
  })

  test('a nested commit waits for its running statement and rejects statements sent meanwhile', async () => {
    const { driverAdapter, transactionManager, id, inner } = await startNested()
    const insert = holdInserts(driverAdapter)

    const running = inner.executeRaw(INSERT)
    const committing = transactionManager.commitTransaction(id)

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS * 5)
    await expect(inner.executeRaw(UPDATE)).rejects.toEqual(new TransactionClosedError('query'))
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])

    insert.resolve(1)
    await running
    await committing
    expect(sentSql(driverAdapter)).toEqual(['INSERT', expect.stringMatching(/^RELEASE SAVEPOINT /)])
  })

  test('a nested rollback waits for its running statement for at most the grace period', async () => {
    const { driverAdapter, transactionManager, id, inner } = await startNested()
    holdInserts(driverAdapter)

    void inner.executeRaw(INSERT)
    const rollingBack = trackSettled(transactionManager.rollbackTransaction(id))

    await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS - 1)
    await expect(inner.executeRaw(UPDATE)).rejects.toEqual(new TransactionRolledBackError('query'))
    expect(sentSql(driverAdapter)).toEqual(['INSERT'])

    await vi.advanceTimersByTimeAsync(1)
    expect(sentSql(driverAdapter)).toEqual([
      'INSERT',
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
    ])
    expect(rollingBack.settled).toBe(true)
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

test('the adapter transaction is closed once when commit, rollback, timeout and disconnect race', async () => {
  const { driverAdapter, transactionManager } = setup()
  const id = await startTransaction(transactionManager)
  const handle = await transactionManager.getTransaction({ id }, 'query')
  const insert = holdInserts(driverAdapter)

  void handle.executeRaw(INSERT).catch(() => {})
  const closes = Promise.allSettled([
    transactionManager.commitTransaction(id),
    transactionManager.rollbackTransaction(id),
    transactionManager.cancelAllTransactions(),
  ])

  await vi.advanceTimersByTimeAsync(TRANSACTION_EXECUTION_TIMEOUT + ROLLBACK_GRACE_MS)
  insert.resolve(1)
  await vi.advanceTimersByTimeAsync(ROLLBACK_GRACE_MS)
  await closes

  expect(driverAdapter.commitMock.mock.calls.length + driverAdapter.rollbackMock.mock.calls.length).toBe(1)
  expect(sentSql(driverAdapter)).toEqual(['INSERT', 'COMMIT'])
})

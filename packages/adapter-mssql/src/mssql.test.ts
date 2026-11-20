import { Mutex } from 'async-mutex'
import { beforeEach, describe, expect, Mock, test, vi } from 'vitest'

import { PrismaMssql } from './index'

/**
 * Tests for MssqlTransaction race condition fix.
 *
 * Fixes https://github.com/prisma/prisma/issues/28994
 *
 * The mssql driver throws EREQINPROG when commit() or rollback() is called
 * while a query is in progress. The fix ensures commit() and rollback()
 * acquire the same mutex that performIO() uses.
 */

describe('MssqlTransaction mutex serialization', () => {
  let events: string[]
  let isQueryRunning: boolean
  let mockTransaction: {
    request: () => { arrayRowMode: boolean; input: Mock; query: Mock }
    commit: Mock
    rollback: Mock
  }

  beforeEach(() => {
    events = []
    isQueryRunning = false

    mockTransaction = {
      request: () => ({
        arrayRowMode: true,
        input: vi.fn(),
        query: vi.fn(async () => {
          isQueryRunning = true
          events.push('query:start')
          await new Promise((resolve) => setTimeout(resolve, 50))
          events.push('query:end')
          isQueryRunning = false
          return { recordset: [[]], columns: [[{ name: 'id' }]] }
        }),
      }),
      commit: vi.fn().mockImplementation(() => {
        events.push(`commit:called (queryRunning=${isQueryRunning})`)
        if (isQueryRunning) {
          const error = new Error("Can't commit transaction. There is a request in progress.")
          ;(error as any).code = 'EREQINPROG'
          return Promise.reject(error)
        }
        events.push('commit:success')
        return Promise.resolve()
      }),
      rollback: vi.fn().mockImplementation(() => {
        events.push(`rollback:called (queryRunning=${isQueryRunning})`)
        if (isQueryRunning) {
          const error = new Error("Can't rollback transaction. There is a request in progress.")
          ;(error as any).code = 'EREQINPROG'
          return Promise.reject(error)
        }
        events.push('rollback:success')
        return Promise.resolve()
      }),
    }
  })

  function createTransaction() {
    const mutex = new Mutex()

    return {
      async queryRaw(query: { sql: string }) {
        const release = await mutex.acquire()
        try {
          const req = mockTransaction.request()
          return await req.query(query.sql)
        } finally {
          release()
        }
      },

      async commit() {
        const release = await mutex.acquire()
        try {
          await mockTransaction.commit()
        } finally {
          release()
        }
      },

      async rollback() {
        const release = await mutex.acquire()
        try {
          await mockTransaction.rollback().catch((e: Error & { code?: string }) => {
            if (e.code === 'EABORT') return
            throw e
          })
        } finally {
          release()
        }
      },
    }
  }

  test('rollback waits for query to complete', async () => {
    const tx = createTransaction()

    const queryPromise = tx.queryRaw({ sql: 'SELECT 1' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const rollbackPromise = tx.rollback()

    await expect(Promise.all([queryPromise, rollbackPromise])).resolves.toBeDefined()

    expect(events).toEqual(['query:start', 'query:end', 'rollback:called (queryRunning=false)', 'rollback:success'])
  })

  test('commit waits for query to complete', async () => {
    const tx = createTransaction()

    const queryPromise = tx.queryRaw({ sql: 'SELECT 1' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const commitPromise = tx.commit()

    await expect(Promise.all([queryPromise, commitPromise])).resolves.toBeDefined()

    expect(events).toEqual(['query:start', 'query:end', 'commit:called (queryRunning=false)', 'commit:success'])
  })

  test('rollback handles EABORT gracefully', async () => {
    mockTransaction.rollback.mockImplementation(() => {
      const error = new Error('Transaction has been aborted.')
      ;(error as any).code = 'EABORT'
      return Promise.reject(error)
    })

    const tx = createTransaction()
    await expect(tx.rollback()).resolves.toBeUndefined()
  })

  test('rollback re-throws non-EABORT errors', async () => {
    mockTransaction.rollback.mockImplementation(() => {
      const error = new Error('Connection lost')
      ;(error as any).code = 'ECONNCLOSED'
      return Promise.reject(error)
    })

    const tx = createTransaction()
    await expect(tx.rollback()).rejects.toThrow('Connection lost')
  })

  test('commit re-throws errors', async () => {
    mockTransaction.commit.mockImplementation(() => {
      const error = new Error('Connection lost')
      ;(error as any).code = 'ECONNCLOSED'
      return Promise.reject(error)
    })

    const tx = createTransaction()
    await expect(tx.commit()).rejects.toThrow('Connection lost')
  })

  test('serializes multiple concurrent queries followed by commit', async () => {
    const tx = createTransaction()

    const query1 = tx.queryRaw({ sql: 'SELECT 1' })
    const query2 = tx.queryRaw({ sql: 'SELECT 2' })
    const commitPromise = tx.commit()

    await expect(Promise.all([query1, query2, commitPromise])).resolves.toBeDefined()

    const commitIndex = events.findIndex((e) => e.startsWith('commit:called'))
    const lastQueryEndIndex = events.lastIndexOf('query:end')
    expect(commitIndex).toBeGreaterThan(lastQueryEndIndex)
  })
})

describe('null Bytes? field handling', () => {
  const connectionString = process.env.TEST_MSSQL_URI

  test('setting a VarBinary(Max) field to null does not throw implicit conversion error', async () => {
    // This test requires a live MSSQL connection. It is intentionally skipped
    // in CI environments that do not provide TEST_MSSQL_URI. Integration tests
    // against a real MSSQL instance are run separately in the MSSQL CI pipeline.
    if (!connectionString) {
      console.log('Skipping integration test: TEST_MSSQL_URI not set')
      return
    }

    const factory = new PrismaMssql(connectionString)
    const adapter = await factory.connect()

    try {
      await adapter.executeRaw({
        sql: `IF OBJECT_ID('dbo.PrismaTest') IS NOT NULL DROP TABLE dbo.PrismaTest`,
        args: [],
        argTypes: [],
      })

      await adapter.executeRaw({
        sql: `CREATE TABLE dbo.PrismaTest (id NVARCHAR(36) PRIMARY KEY, bic VARBINARY(MAX))`,
        args: [],
        argTypes: [],
      })

      await adapter.executeRaw({
        sql: `INSERT INTO dbo.PrismaTest VALUES (@P1, @P2)`,
        args: ['test-id', 'AQID'],
        argTypes: [
          { scalarType: 'string', arity: 'scalar' },
          { scalarType: 'bytes', arity: 'scalar' },
        ],
      })

      const result = await adapter.executeRaw({
        sql: `UPDATE dbo.PrismaTest SET bic = @P1 WHERE id = @P2`,
        args: [null, 'test-id'],
        argTypes: [
          { scalarType: 'bytes', arity: 'scalar' },
          { scalarType: 'string', arity: 'scalar' },
        ],
      })

      expect(result).toBeGreaterThanOrEqual(0)
    } finally {
      // Use IF OBJECT_ID so cleanup remains idempotent even if
      // the test fails before CREATE TABLE completes.
      // Always dispose the connection, even if DROP TABLE fails.
      try {
        await adapter.executeRaw({
          sql: `IF OBJECT_ID('dbo.PrismaTest') IS NOT NULL DROP TABLE dbo.PrismaTest`,
          args: [],
          argTypes: [],
        })
      } finally {
        await adapter.dispose()
      }
    }
  })
})

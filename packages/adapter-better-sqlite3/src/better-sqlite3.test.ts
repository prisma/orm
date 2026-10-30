import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { PrismaBetterSqlite3Adapter } from './better-sqlite3'

describe('PrismaBetterSqlite3Adapter', () => {
  it('does not leak transaction mutex when BEGIN throws', async () => {
    const db = new Database(':memory:')
    const adapter = new PrismaBetterSqlite3Adapter(db)

    // Force BEGIN to fail on the first invocation
    const originalPrepare = db.prepare.bind(db)
    let shouldFail = true
    db.prepare = ((sql: string) => {
      if (sql === 'BEGIN' && shouldFail) {
        return {
          run: () => {
            const err = new Error('SQLITE_BUSY: database is locked')
            ;(err as any).code = 'SQLITE_BUSY'
            throw err
          },
        }
      }
      return originalPrepare(sql)
    }) as any

    // First attempt fails with DriverAdapterError
    await expect(adapter.startTransaction()).rejects.toMatchObject({
      name: 'DriverAdapterError',
      cause: {
        _tag: 'SocketTimeout',
      },
    })

    // Subsequent transaction must not hang awaiting mutex acquisition
    shouldFail = false
    const transaction = await adapter.startTransaction()
    expect(transaction).toBeDefined()
    await transaction.rollback()
    await adapter.dispose()
  })
})


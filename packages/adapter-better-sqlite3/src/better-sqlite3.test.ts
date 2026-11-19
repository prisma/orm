import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SqlQuery } from '@prisma/driver-adapter-utils'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { PrismaBetterSqlite3Adapter } from './better-sqlite3'

const COMMIT_QUERY: SqlQuery = { sql: 'COMMIT', args: [], argTypes: [] }
const ROLLBACK_QUERY: SqlQuery = { sql: 'ROLLBACK', args: [], argTypes: [] }

const insertQuery = (value: string): SqlQuery => ({
  sql: 'INSERT INTO t (v) VALUES (?)',
  args: [value],
  argTypes: [{ scalarType: 'string', arity: 'scalar' }],
})

/**
 * The transaction manager dispatches COMMIT and ROLLBACK as regular queries and then calls the
 * transaction's `commit()`/`rollback()` lifecycle callbacks, so the tests drive the adapter the
 * same way `TransactionManager.#closeTransaction` does.
 */
function createAdapter(file?: string) {
  const db = new Database(file ?? ':memory:', { timeout: 0 })
  db.defaultSafeIntegers(true)
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare("INSERT INTO t (v) VALUES ('x')").run()
  return { db, adapter: new PrismaBetterSqlite3Adapter(db) }
}

describe('better-sqlite3 driver adapter transactions', () => {
  const tmpDirs: string[] = []

  afterEach(() => {
    for (const dir of tmpDirs) {
      // Best-effort: on Windows an open handle can keep the temp dir locked.
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    tmpDirs.length = 0
  })

  it('commits a successful transaction', async () => {
    const { db, adapter } = createAdapter()

    const tx = await adapter.startTransaction()
    await tx.executeRaw(insertQuery('a'))
    await tx.executeRaw(COMMIT_QUERY)
    await tx.commit()

    expect(db.inTransaction).toBe(false)
    expect(
      db
        .prepare('SELECT v FROM t ORDER BY v')
        .all()
        .map((row) => (row as { v: string }).v),
    ).toEqual(['a', 'x'])

    await adapter.dispose()
  })

  it('rolls back a successful transaction', async () => {
    const { db, adapter } = createAdapter()

    const tx = await adapter.startTransaction()
    await tx.executeRaw(insertQuery('a'))
    await tx.executeRaw(ROLLBACK_QUERY)
    await tx.rollback()

    expect(db.inTransaction).toBe(false)
    expect(
      db
        .prepare('SELECT v FROM t ORDER BY v')
        .all()
        .map((row) => (row as { v: string }).v),
    ).toEqual(['x'])

    await adapter.dispose()
  })

  it('recovers the connection after a COMMIT hits SQLITE_BUSY', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'better-sqlite3-adapter-'))
    tmpDirs.push(dir)
    const file = join(dir, 'test.db')
    const { db, adapter } = createAdapter(file)

    let reader: Database.Database | undefined
    try {
      // A second connection holding a read transaction keeps a SHARED lock on the database,
      // so the adapter's COMMIT cannot upgrade to EXCLUSIVE and fails with SQLITE_BUSY.
      reader = new Database(file, { timeout: 0 })
      reader.prepare('BEGIN').run()
      reader.prepare('SELECT COUNT(*) FROM t').get()

      const tx = await adapter.startTransaction()
      await tx.executeRaw(insertQuery('y'))
      await expect(tx.executeRaw(COMMIT_QUERY)).rejects.toThrow()

      // The transaction manager calls rollback() without sending a ROLLBACK query on the
      // failed-COMMIT path; the connection must still be left outside a transaction.
      await tx.rollback()
      expect(db.inTransaction).toBe(false)

      reader.prepare('COMMIT').run()

      // A later transaction on the same adapter must be able to commit again, and the writes
      // of the failed transaction must not survive.
      const tx2 = await adapter.startTransaction()
      await tx2.executeRaw(insertQuery('z'))
      await tx2.executeRaw(COMMIT_QUERY)
      await tx2.commit()

      expect(
        db
          .prepare('SELECT v FROM t ORDER BY v')
          .all()
          .map((row) => (row as { v: string }).v),
      ).toEqual(['x', 'z'])
    } finally {
      reader?.close()
      await adapter.dispose().catch(() => {})
    }
  })

  it('preserves the original error and releases the mutex when rollback cleanup fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'better-sqlite3-adapter-'))
    tmpDirs.push(dir)
    const file = join(dir, 'test.db')
    const { db, adapter } = createAdapter(file)

    let reader: Database.Database | undefined
    try {
      reader = new Database(file, { timeout: 0 })
      reader.prepare('BEGIN').run()
      reader.prepare('SELECT COUNT(*) FROM t').get()

      const tx = await adapter.startTransaction()
      await tx.executeRaw(insertQuery('y'))

      // Make the cleanup ROLLBACK issued by rollback() fail as well, so the
      // cleanup path itself cannot release the connection.
      const originalExec = db.exec.bind(db)
      db.exec = ((sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('cleanup boom')
        return originalExec(sql)
      }) as typeof db.exec

      const commitError = (await tx.executeRaw(COMMIT_QUERY).then(
        () => null,
        (e) => e as Error & { cause?: { originalCode?: string } },
      ))!

      // The original COMMIT error stays the externally observed error and is not
      // replaced or masked by the cleanup failure.
      expect(commitError.cause?.originalCode).toBe('SQLITE_BUSY')
      expect(commitError.message).not.toContain('cleanup boom')

      // rollback() must not throw when the cleanup ROLLBACK fails.
      await tx.rollback()

      // The mutex must still be released: the next startTransaction must reject
      // (BEGIN fails on the still-open transaction) instead of hanging forever.
      const result = await Promise.race([
        adapter.startTransaction().then(
          () => 'resolved',
          () => 'rejected',
        ),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
      ])

      expect(result).toBe('rejected')
    } finally {
      reader?.close()
      await adapter.dispose().catch(() => {})
    }
  })

  it('releases the mutex when BEGIN fails', async () => {
    const db = new Database(':memory:', { timeout: 0 })
    db.defaultSafeIntegers(true)
    const adapter = new PrismaBetterSqlite3Adapter(db)
    db.close()

    await expect(adapter.startTransaction()).rejects.toThrow()

    // With the mutex leaked, the second start would never acquire it and hang forever.
    const result = await Promise.race([
      adapter.startTransaction().then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ])

    expect(result).toBe('rejected')
  })
})

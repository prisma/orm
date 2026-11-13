import type { SqlQuery, Transaction } from '@prisma/driver-adapter-utils'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrismaBetterSqlite3Adapter } from './better-sqlite3'

const sql = (query: string): SqlQuery => ({ sql: query, args: [], argTypes: [] })

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

// This adapter reports `usePhantomQuery: false`, so the query engine runtime ends a transaction by
// running `COMMIT` / `ROLLBACK` as a regular query on the transaction and only then calling
// `commit()` / `rollback()`, which release the adapter's lock.
const endTransaction = async (tx: Transaction, statement: 'COMMIT' | 'ROLLBACK') => {
  await tx.executeRaw(sql(statement))
  await (statement === 'COMMIT' ? tx.commit() : tx.rollback())
}

describe('queries on the base adapter while an interactive transaction is open', () => {
  let db: Database.Database
  let adapter: PrismaBetterSqlite3Adapter

  const readValues = async () => {
    const { rows } = await adapter.queryRaw(sql('SELECT v FROM t ORDER BY id'))
    return rows.map((row) => row[0])
  }

  beforeEach(async () => {
    db = new Database(':memory:')
    db.defaultSafeIntegers(true)
    adapter = new PrismaBetterSqlite3Adapter(db)
    await adapter.executeScript(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'a'), (2, 'b');",
    )
  })

  afterEach(async () => {
    await adapter.dispose()
  })

  it('does not run a write inside the transaction, so a rollback cannot undo it', async () => {
    const tx = await adapter.startTransaction()
    await tx.executeRaw(sql("UPDATE t SET v = 'A-uncommitted' WHERE id = 1"))

    let outsideWriteDone = false
    const outsideWrite = adapter.executeRaw(sql("UPDATE t SET v = 'B-committed' WHERE id = 2")).then(() => {
      outsideWriteDone = true
    })

    await nextTick()
    expect(outsideWriteDone).toBe(false)

    await endTransaction(tx, 'ROLLBACK')
    await outsideWrite

    expect(await readValues()).toEqual(['a', 'B-committed'])
  })

  it('does not let a read see the uncommitted writes of the transaction', async () => {
    const tx = await adapter.startTransaction()
    await tx.executeRaw(sql("UPDATE t SET v = 'A-uncommitted' WHERE id = 1"))

    const outsideRead = adapter.queryRaw(sql('SELECT v FROM t WHERE id = 1'))

    await endTransaction(tx, 'ROLLBACK')

    expect((await outsideRead).rows).toEqual([['a']])
  })

  it('lets queries on the transaction itself run while it is open', async () => {
    const tx = await adapter.startTransaction()
    await tx.executeRaw(sql("UPDATE t SET v = 'A-committed' WHERE id = 1"))
    expect((await tx.queryRaw(sql('SELECT v FROM t WHERE id = 1'))).rows).toEqual([['A-committed']])
    await endTransaction(tx, 'COMMIT')

    expect(await readValues()).toEqual(['A-committed', 'b'])
  })

  it('waits for the transaction to finish before running a script', async () => {
    const tx = await adapter.startTransaction()
    await tx.executeRaw(sql("UPDATE t SET v = 'A-uncommitted' WHERE id = 1"))

    let scriptDone = false
    const script = adapter.executeScript("UPDATE t SET v = 'script' WHERE id = 2;").then(() => {
      scriptDone = true
    })

    await nextTick()
    expect(scriptDone).toBe(false)

    await endTransaction(tx, 'ROLLBACK')
    await script

    expect(await readValues()).toEqual(['a', 'script'])
  })

  it('releases the lock when starting the transaction fails', async () => {
    const prepare = db.prepare.bind(db)
    const spy = vi.spyOn(db, 'prepare').mockImplementationOnce((source: string) => {
      if (source === 'BEGIN') {
        throw new Error('simulated BEGIN failure')
      }
      return prepare(source)
    })

    await expect(adapter.startTransaction()).rejects.toThrow()
    spy.mockRestore()

    const timedOut = Symbol('timed out')
    const result = await Promise.race([
      readValues(),
      new Promise<symbol>((resolve) => setTimeout(() => resolve(timedOut), 1_000)),
    ])
    expect(result).not.toBe(timedOut)
    expect(result).toEqual(['a', 'b'])
  })
})

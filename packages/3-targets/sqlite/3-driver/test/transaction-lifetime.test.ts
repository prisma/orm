import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { SqliteConnectionImpl } from '../src/sqlite-driver';

it.each(['commit', 'rollback'] as const)(
  'invalidates a parked iterator on %s without advancing its consumer',
  async (ending) => {
    const db = new DatabaseSync(':memory:');
    const connection = new SqliteConnectionImpl(db);
    const tx = await connection.beginTransaction();
    const stmt = db.prepare('SELECT 1 AS id UNION ALL SELECT 2 AS id');
    const iterator = stmt.iterate();
    const returned = vi.spyOn(iterator, 'return');
    vi.spyOn(stmt, 'iterate').mockReturnValue(iterator);
    const prepared = vi.spyOn(db, 'prepare').mockReturnValue(stmt);
    const rows = tx
      .query({ sql: 'SELECT 1 AS id UNION ALL SELECT 2 AS id' })
      [Symbol.asyncIterator]();
    await rows.next();
    prepared.mockRestore();
    await tx[ending]();
    expect(returned).toHaveBeenCalledTimes(1);
    const next = await connection.beginTransaction();
    await expect(rows.next()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
    await expect(tx.commit()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
    await next.rollback();
    await connection.release();
    expect(returned).toHaveBeenCalledTimes(1);
  },
);

it('preserves a failed COMMIT and allows rollback without reopening the transaction scope', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'PRAGMA foreign_keys = ON; CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)',
  );
  const connection = new SqliteConnectionImpl(db);
  const tx = await connection.beginTransaction();
  await tx.execute({ sql: 'INSERT INTO child VALUES (1)' });
  await expect(tx.commit()).rejects.toMatchObject({
    kind: 'sql_query',
    cause: { code: 'ERR_SQLITE_ERROR' },
  });
  await expect(tx.execute({ sql: 'INSERT INTO parent VALUES (1)' })).rejects.toMatchObject({
    code: 'DRIVER.NOT_CONNECTED',
  });
  await tx.rollback();
  const next = await connection.beginTransaction();
  expect(
    await next.query({ sql: 'SELECT COUNT(*) AS n FROM child' })[Symbol.asyncIterator]().next(),
  ).toEqual({ done: false, value: { n: 0 } });
  await next.rollback();
  await connection.release();
});

it('unregisters a closed statement even when its return reports failure', async () => {
  const db = new DatabaseSync(':memory:');
  const connection = new SqliteConnectionImpl(db);
  const tx = await connection.beginTransaction();
  const stmt = db.prepare('SELECT 1 UNION ALL SELECT 2');
  const iterator = stmt.iterate();
  const originalReturn = iterator.return?.bind(iterator);
  const failure = new Error('return failed');
  const returned = vi.spyOn(iterator, 'return').mockImplementation(() => {
    originalReturn?.();
    throw failure;
  });
  vi.spyOn(stmt, 'iterate').mockReturnValue(iterator);
  vi.spyOn(db, 'prepare').mockReturnValue(stmt);
  await tx.query({ sql: 'SELECT 1 UNION ALL SELECT 2' })[Symbol.asyncIterator]().next();
  await expect(tx.rollback()).rejects.toBe(failure);
  await tx.rollback();
  await connection.release();
  expect(returned).toHaveBeenCalledTimes(1);
});

it('closes parked statements before database disposal and permits repeated disposal', async () => {
  const db = new DatabaseSync(':memory:');
  const connection = new SqliteConnectionImpl(db);
  const stmt = db.prepare('SELECT 1 UNION ALL SELECT 2');
  const iterator = stmt.iterate();
  const returned = vi.spyOn(iterator, 'return');
  vi.spyOn(stmt, 'iterate').mockReturnValue(iterator);
  vi.spyOn(db, 'prepare').mockReturnValue(stmt);
  const rows = connection.query({ sql: 'SELECT 1 UNION ALL SELECT 2' })[Symbol.asyncIterator]();
  await rows.next();
  await connection.destroy();
  await connection.destroy();
  expect(returned).toHaveBeenCalledTimes(1);
  await expect(rows.next()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
});

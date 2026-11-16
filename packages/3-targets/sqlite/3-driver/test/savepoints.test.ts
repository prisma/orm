import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { SqliteConnectionImpl } from '../src/sqlite-driver';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE items (value INTEGER)');
  const connection = new SqliteConnectionImpl(db);
  const values = () => db.prepare('SELECT value FROM items ORDER BY value').all();
  const insert = (tx: { execute(r: { sql: string }): Promise<unknown> }, value: number) =>
    tx.execute({ sql: `INSERT INTO items VALUES (${value})` });
  return { db, connection, values, insert };
}

describe('SQLite savepoints', () => {
  it('keeps the work of a released savepoint', async () => {
    const { connection, values, insert } = setup();
    const tx = await connection.beginTransaction();
    await insert(tx, 1);
    const sp = await tx.savepoint('sp_1');
    await insert(sp, 2);
    await sp.commit();
    await tx.commit();
    expect(values()).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it('loses the work of a rolled-back savepoint and commits the rest', async () => {
    const { connection, values, insert } = setup();
    const tx = await connection.beginTransaction();
    await insert(tx, 1);
    const sp = await tx.savepoint('sp_1');
    await insert(sp, 2);
    await sp.rollback();
    await insert(tx, 3);
    await tx.commit();
    expect(values()).toEqual([{ value: 1 }, { value: 3 }]);
  });

  it('nests a savepoint inside a savepoint', async () => {
    const { db, connection, values, insert } = setup();
    const exec = vi.spyOn(db, 'exec');
    const tx = await connection.beginTransaction();
    const outer = await tx.savepoint('outer_sp');
    await insert(outer, 1);
    const inner = await outer.savepoint('inner_sp');
    await insert(inner, 2);
    await inner.rollback();
    await insert(outer, 3);
    await outer.commit();
    await tx.commit();
    expect(values()).toEqual([{ value: 1 }, { value: 3 }]);
    expect(exec.mock.calls).toEqual([
      ['BEGIN'],
      ['SAVEPOINT outer_sp'],
      ['SAVEPOINT inner_sp'],
      ['ROLLBACK TO SAVEPOINT inner_sp'],
      ['RELEASE SAVEPOINT outer_sp'],
      ['COMMIT'],
    ]);
  });

  it.each(['', '1sp', 'a b', 'sp; DROP TABLE items'])('rejects %j before any SQL', async (name) => {
    const { db, connection } = setup();
    const tx = await connection.beginTransaction();
    const exec = vi.spyOn(db, 'exec');
    await expect(tx.savepoint(name)).rejects.toMatchObject({ code: 'RUNTIME.ARGUMENT_INVALID' });
    const sp = await tx.savepoint('sp_1');
    await expect(sp.savepoint(name)).rejects.toMatchObject({ code: 'RUNTIME.ARGUMENT_INVALID' });
    expect(exec.mock.calls).toEqual([['SAVEPOINT sp_1']]);
    await tx.rollback();
  });
});

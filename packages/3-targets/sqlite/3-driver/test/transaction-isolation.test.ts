import { DatabaseSync } from 'node:sqlite';
import type { SqlTransactionOptions } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { SqliteConnectionImpl } from '../src/sqlite-driver';

describe('SQLite transaction isolation', () => {
  it.each([
    undefined,
    {},
    { isolationLevel: undefined },
    { isolationLevel: 'Serializable' },
  ] as const)('uses plain BEGIN for %j and preserves PRAGMAs on reuse', async (start) => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE items (value INTEGER)');
    const connection = new SqliteConnectionImpl(db);
    const exec = vi.spyOn(db, 'exec');
    const pragmaBefore = db.prepare('PRAGMA read_uncommitted').get();
    try {
      const tx = await connection.beginTransaction(start);
      await tx.execute({ sql: 'INSERT INTO items VALUES (1)' });
      await tx.commit();
      const next = await connection.beginTransaction();
      await next.execute({ sql: 'INSERT INTO items VALUES (2)' });
      await next.rollback();
      expect(db.prepare('SELECT value FROM items').all()).toEqual([{ value: 1 }]);
      expect(db.prepare('PRAGMA read_uncommitted').get()).toEqual(pragmaBefore);
      expect(exec.mock.calls).toEqual([['BEGIN'], ['COMMIT'], ['BEGIN'], ['ROLLBACK']]);
    } finally {
      await connection.release();
    }
  });

  it.each([
    null,
    0,
    true,
    'ReadUncommitted',
    'ReadCommitted',
    'RepeatableRead',
    'Serializable; SELECT 1',
  ])('rejects %j before any SQL', async (isolationLevel) => {
    const db = new DatabaseSync(':memory:');
    const connection = new SqliteConnectionImpl(db);
    const exec = vi.spyOn(db, 'exec');
    try {
      await expect(
        connection.beginTransaction({ isolationLevel } as SqlTransactionOptions),
      ).rejects.toMatchObject({ code: 'RUNTIME.ARGUMENT_INVALID' });
      expect(exec).not.toHaveBeenCalled();
    } finally {
      await connection.destroy();
    }
  });
});

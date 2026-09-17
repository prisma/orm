import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqlQueryError } from '@internal/sql-errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBoundDriverFromBinding,
  type SqliteBinding,
  SqliteConnectionImpl,
} from '../src/sqlite-driver';
import { executeSql, queryRows } from './sql-queryable-test-utils';

let testDir: string;
let testPath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-test-'));
  testPath = join(testDir, 'test.db');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function createDriver() {
  const binding: SqliteBinding = { kind: 'path', path: testPath };
  return createBoundDriverFromBinding(binding);
}

describe('SqliteBoundDriver', () => {
  it('connects to a file database', async () => {
    const driver = createDriver();
    expect(driver.state).toBe('connected');
    await driver.close();
  });

  it('executes CREATE TABLE and INSERT via execute()', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)');
    await executeSql(driver, 'INSERT INTO t VALUES (?, ?)', [1, 'alice']);
    const result = await queryRows<{ id: number; name: string }>(driver, 'SELECT * FROM t');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, name: 'alice' });
    await driver.close();
  });

  it('streams SELECT rows via query()', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
    await executeSql(driver, 'INSERT INTO t VALUES (1, ?)', ['a']);
    await executeSql(driver, 'INSERT INTO t VALUES (2, ?)', ['b']);
    await executeSql(driver, 'INSERT INTO t VALUES (3, ?)', ['c']);

    const rows: Array<{ id: number; val: string }> = [];
    for await (const row of driver.query<{ id: number; val: string }>({
      sql: 'SELECT * FROM t ORDER BY id',
    })) {
      rows.push(row);
    }

    expect(rows).toEqual([
      { id: 1, val: 'a' },
      { id: 2, val: 'b' },
      { id: 3, val: 'c' },
    ]);
    await driver.close();
  });

  it('reports affected rows from stmt.run().changes', async () => {
    const run = vi.fn(() => ({ changes: 3, lastInsertRowid: 0 }));
    const db = {
      prepare: vi.fn(() => ({ columns: () => [], run })),
    } as unknown as DatabaseSync;
    const connection = new SqliteConnectionImpl(db);

    await expect(connection.execute({ sql: 'UPDATE t SET value = ?' })).resolves.toEqual({
      affectedRows: 3,
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects RETURNING statements routed through execute()', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, value TEXT)');

    await expect(
      driver.execute({ sql: "INSERT INTO t(value) VALUES ('lost') RETURNING id" }),
    ).rejects.toThrow('cannot execute statements that return rows');

    await expect(
      queryRows<{ id: number; value: string }>(driver, 'SELECT * FROM t'),
    ).resolves.toEqual([]);
    await driver.close();
  });

  it('supports EXPLAIN QUERY PLAN', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');

    const explain = await driver.explain!({ sql: 'SELECT * FROM t WHERE id = 1' });
    expect(explain.rows.length).toBeGreaterThan(0);
    await driver.close();
  });

  it('enables foreign keys by default', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE parent(id INTEGER PRIMARY KEY)');
    await executeSql(
      driver,
      'CREATE TABLE child(id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id))',
    );
    await executeSql(driver, 'INSERT INTO parent VALUES (?)', [1]);

    await expect(executeSql(driver, 'INSERT INTO child VALUES (?, ?)', [1, 999])).rejects.toThrow(
      SqlQueryError,
    );
    await driver.close();
  });

  it('close() is idempotent', async () => {
    const driver = createDriver();
    await driver.close();
    expect(driver.state).toBe('closed');
    await driver.close();
    expect(driver.state).toBe('closed');
  });

  it('normalizes unique constraint errors to SqlQueryError', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT UNIQUE)');
    await executeSql(driver, 'INSERT INTO t VALUES (?, ?)', [1, 'a']);

    try {
      await executeSql(driver, 'INSERT INTO t VALUES (?, ?)', [2, 'a']);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(SqlQueryError.is(error)).toBe(true);
      expect((error as SqlQueryError).sqlState).toBe('23505');
    }
    await driver.close();
  });

  it('normalizes foreign key constraint errors to SqlQueryError', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE parent(id INTEGER PRIMARY KEY)');
    await executeSql(
      driver,
      'CREATE TABLE child(id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id))',
    );

    try {
      await executeSql(driver, 'INSERT INTO child VALUES (?, ?)', [1, 999]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(SqlQueryError.is(error)).toBe(true);
      expect((error as SqlQueryError).sqlState).toBe('23503');
    }
    await driver.close();
  });
});

describe('SqliteConnection', () => {
  it('acquireConnection returns a connection that shares database state', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY)');
    const conn = await driver.acquireConnection();
    const result = await queryRows<{ id: number }>(conn, 'SELECT * FROM t');
    expect(result).toHaveLength(0);
    await conn.release();
    await driver.close();
  });

  it('independent connections have isolated transactions', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');

    const conn1 = await driver.acquireConnection();
    const conn2 = await driver.acquireConnection();

    const tx1 = await conn1.beginTransaction();
    await executeSql(tx1, 'INSERT INTO t VALUES (?, ?)', [1, 'from-tx1']);
    await tx1.commit();

    // conn2 sees committed data
    const after = await queryRows<{ id: number }>(conn2, 'SELECT * FROM t');
    expect(after).toHaveLength(1);

    await conn1.release();
    await conn2.release();
    await driver.close();
  });
});

describe('SqliteTransaction', () => {
  it('commits a transaction', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');

    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    await executeSql(tx, 'INSERT INTO t VALUES (?, ?)', [1, 'a']);
    await executeSql(tx, 'INSERT INTO t VALUES (?, ?)', [2, 'b']);
    await tx.commit();
    await conn.release();

    const result = await queryRows<{ id: number }>(driver, 'SELECT * FROM t');
    expect(result).toHaveLength(2);
    await driver.close();
  });

  it('rolls back a transaction', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
    await executeSql(driver, 'INSERT INTO t VALUES (?, ?)', [1, 'before']);

    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    await executeSql(tx, 'INSERT INTO t VALUES (?, ?)', [2, 'rolled-back']);
    await tx.rollback();
    await conn.release();

    const result = await queryRows<{ id: number }>(driver, 'SELECT * FROM t');
    expect(result).toHaveLength(1);
    await driver.close();
  });

  it('supports execute() within a transaction', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');

    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    await executeSql(tx, 'INSERT INTO t VALUES (?, ?)', [1, 'a']);

    const rows: Array<{ id: number; val: string }> = [];
    for await (const row of tx.query<{ id: number; val: string }>({
      sql: 'SELECT * FROM t',
    })) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);

    await tx.commit();
    await conn.release();
    await driver.close();
  });
});

describe('SqliteConnectionImpl cleanup retries', () => {
  it('release() leaves the connection retryable when close() throws', async () => {
    const db = new DatabaseSync(':memory:');
    const closeSpy = vi.spyOn(db, 'close').mockImplementationOnce(() => {
      throw new Error('busy: statement in progress');
    });

    const connection = new SqliteConnectionImpl(db);

    // First release surfaces the close error (release must not swallow).
    await expect(connection.release()).rejects.toThrow('busy');
    expect(closeSpy).toHaveBeenCalledTimes(1);

    // The handle is still open; a retry must actually attempt close again
    // instead of short-circuiting on an internal "disposed" flag.
    closeSpy.mockRestore();
    await expect(connection.release()).resolves.toBeUndefined();
    expect(db.isOpen).toBe(false);
  });

  it('destroy() propagates close() errors and leaves the connection retryable', async () => {
    const db = new DatabaseSync(':memory:');
    const closeSpy = vi.spyOn(db, 'close').mockImplementationOnce(() => {
      throw new Error('busy: statement in progress');
    });

    const connection = new SqliteConnectionImpl(db);

    // destroy() propagates teardown errors; the call site decides whether to
    // swallow. The connection is left retryable so a follow-up cleanup can
    // actually close the handle once the underlying condition clears.
    await expect(connection.destroy(new Error('rollback failed'))).rejects.toThrow('busy');
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(db.isOpen).toBe(true);

    closeSpy.mockRestore();
    await expect(connection.destroy()).resolves.toBeUndefined();
    expect(db.isOpen).toBe(false);
  });

  it('release() after a failed destroy() finally closes the handle', async () => {
    const db = new DatabaseSync(':memory:');
    const closeSpy = vi.spyOn(db, 'close').mockImplementationOnce(() => {
      throw new Error('busy: statement in progress');
    });

    const connection = new SqliteConnectionImpl(db);

    await expect(connection.destroy(new Error('rollback failed'))).rejects.toThrow('busy');
    expect(db.isOpen).toBe(true);

    closeSpy.mockRestore();
    await expect(connection.release()).resolves.toBeUndefined();
    expect(db.isOpen).toBe(false);
  });
});

describe('SqliteConnection isolation level', () => {
  it('rejects a requested isolation level without beginning a transaction', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY)');
    const conn = await driver.acquireConnection();

    await expect(conn.beginTransaction({ isolationLevel: 'serializable' })).rejects.toMatchObject({
      code: 'DRIVER.ISOLATION_LEVEL_UNSUPPORTED',
      details: { target: 'sqlite', isolationLevel: 'serializable' },
    });

    const tx = await conn.beginTransaction();
    await executeSql(tx, 'INSERT INTO t VALUES (?)', [1]);
    await tx.commit();
    await conn.release();

    expect(await queryRows<{ id: number }>(driver, 'SELECT id FROM t')).toEqual([{ id: 1 }]);
    await driver.close();
  });
});

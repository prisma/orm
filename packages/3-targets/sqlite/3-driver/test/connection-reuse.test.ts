import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  createBoundDriverFromBinding,
  type SqliteBinding,
  SqliteDriver,
} from '../src/sqlite-driver';
import { executeSql, queryRows } from './sql-queryable-test-utils';

let testDir: string;
let testPath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-test-'));
  testPath = join(testDir, 'test.db');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(testDir, { recursive: true, force: true });
});

function createDriver() {
  const binding: SqliteBinding = { kind: 'path', path: testPath };
  return createBoundDriverFromBinding(binding);
}

function spyExec(): MockInstance {
  return vi.spyOn(DatabaseSync.prototype, 'exec');
}

function openedDatabases(execSpy: MockInstance): DatabaseSync[] {
  return execSpy.mock.calls.flatMap((call, index) => {
    const context = execSpy.mock.contexts[index];
    return call[0] === 'PRAGMA foreign_keys = ON' && context instanceof DatabaseSync
      ? [context]
      : [];
  });
}

function spyPrepare(): MockInstance {
  return vi.spyOn(DatabaseSync.prototype, 'prepare');
}

function prepareCallsOf(prepareSpy: MockInstance, sql: string): number {
  return prepareSpy.mock.calls.filter((call) => call[0] === sql).length;
}

describe('SQLite connection reuse', () => {
  it('reuses one connection across sequential transactions', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');

    const execSpy = spyExec();
    for (const [index, value] of ['a', 'b', 'c'].entries()) {
      const conn = await driver.acquireConnection();
      const tx = await conn.beginTransaction();
      await executeSql(tx, 'INSERT INTO t VALUES (?, ?)', [index + 1, value]);
      await tx.commit();
      await conn.release();
    }

    const opened = openedDatabases(execSpy);
    expect(opened).toHaveLength(1);
    expect(new Set(opened).size).toBe(1);
    expect(
      await queryRows<{ id: number; val: string }>(driver, 'SELECT * FROM t ORDER BY id'),
    ).toEqual([
      { id: 1, val: 'a' },
      { id: 2, val: 'b' },
      { id: 3, val: 'c' },
    ]);
    await driver.close();
  });

  it('compiles a repeated statement once, not once per transaction', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');

    const prepareSpy = spyPrepare();
    for (const [index, value] of ['a', 'b', 'c'].entries()) {
      const conn = await driver.acquireConnection();
      const tx = await conn.beginTransaction();
      await executeSql(tx, 'INSERT INTO t VALUES (?, ?)', [index + 1, value]);
      await tx.commit();
      await conn.release();
    }

    expect(prepareCallsOf(prepareSpy, 'INSERT INTO t VALUES (?, ?)')).toBe(1);
    await driver.close();
  });

  it('opens a second connection while the first still holds a transaction', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');

    const execSpy = spyExec();
    const conn1 = await driver.acquireConnection();
    const tx1 = await conn1.beginTransaction();
    await executeSql(tx1, 'INSERT INTO t VALUES (?, ?)', [1, 'tx1']);

    const conn2 = await driver.acquireConnection();
    const tx2 = await conn2.beginTransaction();
    await tx1.commit();
    await executeSql(tx2, 'INSERT INTO t VALUES (?, ?)', [2, 'tx2']);
    await tx2.commit();
    await conn1.release();
    await conn2.release();

    expect(await queryRows<{ id: number }>(driver, 'SELECT COUNT(*) AS n FROM t')).toEqual([
      { n: 2 },
    ]);
    expect(openedDatabases(execSpy)).toHaveLength(2);
    await driver.close();
  });

  it('closes the pooled connection when the driver closes', async () => {
    const driver = createDriver();
    const conn = await driver.acquireConnection();
    await conn.release();

    const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close');
    await driver.close();
    expect(closeSpy).toHaveBeenCalledTimes(2);
  });

  it('opens a fresh connection once the pooled one is destroyed', async () => {
    const driver = createDriver();
    const execSpy = spyExec();
    const conn = await driver.acquireConnection();
    await conn.release();
    const reused = await driver.acquireConnection();
    expect(openedDatabases(execSpy)).toHaveLength(1);

    await reused.destroy();
    const fresh = await driver.acquireConnection();
    expect(openedDatabases(execSpy)).toHaveLength(2);
    const tx = await fresh.beginTransaction();
    await tx.rollback();
    await fresh.release();
    await driver.close();
  });

  it('closes rather than pools a connection released with a transaction still open', async () => {
    const driver = createDriver();
    const conn = await driver.acquireConnection();
    await conn.beginTransaction();
    const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close');

    await conn.release();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    const execSpy = spyExec();
    const next = await driver.acquireConnection();
    const tx = await next.beginTransaction();
    await tx.rollback();
    expect(openedDatabases(execSpy)).toHaveLength(1);
    await next.release();
    await driver.close();
  });

  it('does not reuse a connection whose COMMIT failed, even when a later rollback ends the transaction', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE p(id INTEGER PRIMARY KEY)');
    await executeSql(
      driver,
      'CREATE TABLE c(id INTEGER, pid INTEGER REFERENCES p(id) DEFERRABLE INITIALLY DEFERRED)',
    );

    const execSpy = spyExec();
    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    await executeSql(tx, 'INSERT INTO c VALUES (?, ?)', [1, 99]);
    await expect(tx.commit()).rejects.toThrow();
    // The failed COMMIT leaves the transaction open; a successful rollback ends it, so only the
    // terminal-operation failure history can keep this connection out of the idle slot.
    await tx.rollback();

    await conn.release();
    const retry = await driver.acquireConnection();
    expect(openedDatabases(execSpy)).toHaveLength(2);
    const fresh = await retry.beginTransaction();
    await fresh.rollback();
    await retry.release();
    await driver.close();
  });

  it('does not reuse a connection whose ROLLBACK failed', async () => {
    const driver = createDriver();
    const originalExec = DatabaseSync.prototype.exec;
    const conn = await driver.acquireConnection();
    const tx = await conn.beginTransaction();
    const execMock = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (
      this: DatabaseSync,
      sql: string,
    ) {
      originalExec.call(this, sql);
      if (sql === 'ROLLBACK') {
        // The rollback applies, then the operation still reports failure.
        throw new Error('rollback confirmation lost');
      }
      return;
    });
    await expect(tx.rollback()).rejects.toThrow('rollback confirmation lost');
    execMock.mockRestore();

    await conn.release();
    const execSpy = spyExec();
    const next = await driver.acquireConnection();
    // The failed-rollback connection was closed, so this acquisition opens a fresh database.
    expect(openedDatabases(execSpy)).toHaveLength(1);
    const fresh = await next.beginTransaction();
    await fresh.rollback();
    await next.release();
    await driver.close();
  });

  it('closes rather than pools a connection released after the driver closed', async () => {
    const driver = createDriver();
    const conn = await driver.acquireConnection();
    const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close');

    await driver.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    await conn.release();
    expect(closeSpy).toHaveBeenCalledTimes(2);

    // The idle slot holds nothing, so a reconnect opens a fresh database instead of the released one.
    const execSpy = spyExec();
    await driver.connect({ kind: 'path', path: testPath });
    const next = await driver.acquireConnection();
    expect(openedDatabases(execSpy)).toHaveLength(2);
    await next.release();
    await driver.close();
  });

  it('does not hand a released connection from a replaced binding to the new binding', async () => {
    const driver = new SqliteDriver();
    const closeSpy = vi.spyOn(DatabaseSync.prototype, 'close');
    await driver.connect({ kind: 'path', path: join(testDir, 'gen-a.db') });
    const stale = await driver.acquireConnection();
    await executeSql(stale, 'CREATE TABLE in_a(id INTEGER)');

    await driver.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    await driver.connect({ kind: 'path', path: join(testDir, 'gen-b.db') });
    await stale.release();
    // The late release belongs to the replaced binding, so it closes instead of pooling.
    expect(closeSpy).toHaveBeenCalledTimes(2);

    const conn = await driver.acquireConnection();
    await executeSql(conn, 'CREATE TABLE in_b(id INTEGER)');
    await expect(queryRows(conn, 'SELECT * FROM in_a')).rejects.toThrow();
    await conn.release();
    await driver.close();
  });

  it('gives concurrent readers of the same SQL their own compiled statements', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
    await executeSql(driver, 'INSERT INTO t VALUES (?, ?)', [1, 'a']);
    await executeSql(driver, 'INSERT INTO t VALUES (?, ?)', [2, 'b']);

    const stream1 = driver.query<{ id: number }>({ sql: 'SELECT id FROM t ORDER BY id' });
    const reader1 = stream1[Symbol.asyncIterator]();
    const stream2 = driver.query<{ id: number }>({ sql: 'SELECT id FROM t ORDER BY id' });
    const reader2 = stream2[Symbol.asyncIterator]();

    const first1 = await reader1.next();
    const first2 = await reader2.next();
    expect(first1.value).toEqual({ id: 1 });
    expect(first2.value).toEqual({ id: 1 });

    const second1 = await reader1.next();
    const second2 = await reader2.next();
    expect(second1.value).toEqual({ id: 2 });
    expect(second2.value).toEqual({ id: 2 });

    await reader1.return?.();
    await reader2.return?.();
    await driver.close();
  });
});

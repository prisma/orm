import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sqliteControlDriverDescriptor from '../src/exports/control';
import { createBoundDriverFromBinding, SqliteConnectionImpl } from '../src/sqlite-driver';
import { executeSql, queryRows } from './sql-queryable-test-utils';

const MIN_INT64 = -9223372036854775808n;
const MAX_INT64 = 9223372036854775807n;

let testDir: string;
let testPath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-exact-'));
  testPath = join(testDir, 'test.db');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

const createDriver = () => createBoundDriverFromBinding({ kind: 'path', path: testPath });

const WIDE_VALUES_SQL = `SELECT 9007199254740991 AS maxSafe, -9007199254740991 AS minSafe,
  9007199254740992 AS firstUnsafe, ${MAX_INT64} AS maxInt64, ${MIN_INT64} AS minInt64,
  1.5 AS fraction, 'text' AS words, NULL AS absent`;

const WIDE_VALUES = {
  maxSafe: 9007199254740991,
  minSafe: -9007199254740991,
  firstUnsafe: 9007199254740992n,
  maxInt64: MAX_INT64,
  minInt64: MIN_INT64,
  fraction: 1.5,
  words: 'text',
  absent: null,
};

describe('SQLite integers of any 64-bit size', () => {
  it('a query reads an integer within the safe range as a number and one outside it as the exact bigint', async () => {
    const driver = createDriver();
    expect(await queryRows(driver, WIDE_VALUES_SQL)).toEqual([WIDE_VALUES]);
    await driver.close();
  });

  it('the control driver reads integers the same way', async () => {
    const driver = await sqliteControlDriverDescriptor.create(testPath);
    expect(await driver.query(WIDE_VALUES_SQL)).toEqual({ rows: [WIDE_VALUES] });
    await driver.close();
  });

  it('an explained plan reads its integers as numbers', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(await driver.explain({ sql: 'SELECT id FROM t' })).toEqual({
      rows: [{ id: 2, parent: 0, notused: 216, detail: 'SCAN t' }],
    });
    await driver.close();
  });

  it('reports the exact rowid of a row inserted past the safe range', async () => {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(await executeSql(driver, `INSERT INTO t (id) VALUES (${2n ** 60n + 1n})`)).toEqual({
      affectedRows: 1,
      insertId: String(2n ** 60n + 1n),
    });
    await driver.close();
  });
});

describe('a read that stops part-way', () => {
  const writeFromAnotherConnection = (value: number) => {
    const other = new DatabaseSync(testPath);
    try {
      other.exec('PRAGMA busy_timeout = 0');
      other.exec(`INSERT INTO t (id) VALUES (${value})`);
    } finally {
      other.close();
    }
  };

  async function driverWithRows() {
    const driver = createDriver();
    await executeSql(driver, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');
    await executeSql(driver, 'INSERT INTO t (id) VALUES (1), (2), (3)');
    return driver;
  }

  it('leaves no lock behind when SQLite fails on a later row', async () => {
    const driver = await driverWithRows();
    await expect(
      queryRows(driver, "SELECT CASE WHEN id = 2 THEN json('not json') ELSE id END AS v FROM t"),
    ).rejects.toThrow('malformed JSON');
    expect(() => writeFromAnotherConnection(10)).not.toThrow();
    await driver.close();
  });

  it('leaves no lock behind when the reader stops after the first row', async () => {
    const driver = await driverWithRows();
    for await (const _row of driver.query({ sql: 'SELECT id FROM t' })) {
      break;
    }
    expect(() => writeFromAnotherConnection(11)).not.toThrow();
    await driver.close();
  });

  it('leaves no lock behind when the reader fails on a row', async () => {
    const driver = await driverWithRows();
    const failOnFirstRow = async () => {
      for await (const _row of driver.query({ sql: 'SELECT id FROM t' })) {
        throw new Error('the reader failed');
      }
    };
    await expect(failOnFirstRow()).rejects.toThrow('the reader failed');
    expect(() => writeFromAnotherConnection(12)).not.toThrow();
    await driver.close();
  });

  it('leaves no lock behind after reading an integer past the safe range', async () => {
    const driver = await driverWithRows();
    await executeSql(driver, `INSERT INTO t (id) VALUES (${2n ** 60n + 1n})`);
    expect(await queryRows(driver, 'SELECT id FROM t ORDER BY id')).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 2n ** 60n + 1n },
    ]);
    expect(() => writeFromAnotherConnection(13)).not.toThrow();
    await driver.close();
  });
});

describe('a read whose row raises an error', () => {
  function databaseFailingOnSecondRow() {
    const resets: string[] = [];
    let rowsRead = 0;
    const rows: Iterator<Record<string, unknown>> = {
      next() {
        rowsRead += 1;
        if (rowsRead === 2) throw new Error('the second row cannot be read');
        return { done: false, value: { id: BigInt(rowsRead) } };
      },
      return() {
        resets.push('return');
        return { done: true, value: undefined };
      },
    };
    const database = {
      isOpen: true,
      prepare: () => ({ setReadBigInts: () => {}, iterate: () => rows }),
    };
    return { database: database as unknown as DatabaseSync, resets };
  }

  it('resets its statement once and raises the error', async () => {
    const { database, resets } = databaseFailingOnSecondRow();
    const read: unknown[] = [];
    const readAll = async () => {
      for await (const row of new SqliteConnectionImpl(database).query({ sql: 'SELECT id' })) {
        read.push(row);
      }
    };
    await expect(readAll()).rejects.toThrow('the second row cannot be read');
    expect({ read, resets }).toEqual({ read: [{ id: 1 }], resets: ['return'] });
  });
});

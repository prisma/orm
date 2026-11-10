import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sqliteRuntimeDriverDescriptor from '../src/exports/runtime';
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

describe('SqliteRuntimeDriverDescriptor', () => {
  it('transitions from unbound to connected to closed', async () => {
    const driver = sqliteRuntimeDriverDescriptor.create();
    expect(driver.state).toBe('unbound');

    await driver.connect({ kind: 'path', path: testPath });
    expect(driver.state).toBe('connected');

    await driver.close();
    expect(driver.state).toBe('closed');
  });

  it('throws on query before connect', async () => {
    const driver = sqliteRuntimeDriverDescriptor.create();
    await expect(queryRows(driver, 'SELECT 1')).rejects.toThrow('not connected');
  });

  it('throws on double connect', async () => {
    const driver = sqliteRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'path', path: testPath });
    await expect(driver.connect({ kind: 'path', path: testPath })).rejects.toThrow(
      'already connected',
    );
    await driver.close();
  });

  it('execute() throws on an unbound driver', async () => {
    const driver = sqliteRuntimeDriverDescriptor.create();
    await expect(driver.execute({ sql: 'SELECT 1' })).rejects.toThrow('not connected');
  });

  it('works end-to-end after connect', async () => {
    const driver = sqliteRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'path', path: testPath });

    await executeSql(driver, 'CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
    await executeSql(driver, 'INSERT INTO t VALUES (?, ?)', [1, 'hello']);
    const result = await queryRows<{ id: number; val: string }>(driver, 'SELECT * FROM t');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, val: 'hello' });

    await driver.close();
  });
});

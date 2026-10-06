import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';

function createMemoryDriver(location = ':memory:') {
  const db = new DatabaseSync(location);
  const statements: string[] = [];
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      statements.push(sql);
      const rows = db
        .prepare(sql)
        .all(...((params ?? []) as Array<string | number | null>)) as Row[];
      return { rows };
    },
    async close() {
      db.close();
    },
    statements,
  };
}

async function countRows(driver: ReturnType<typeof createMemoryDriver>): Promise<unknown> {
  const { rows } = await driver.query<{ n: number }>('SELECT count(*) AS n FROM t');
  return rows[0]?.n;
}

describe('SqliteControlAdapter.withTransaction', () => {
  const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

  it('commits the work of a callback that resolves and returns its value', async () => {
    const driver = createMemoryDriver();
    await driver.query('CREATE TABLE t (x integer)');

    const result = await adapter.withTransaction(driver, async () => {
      await driver.query('INSERT INTO t (x) VALUES (1)');
      return 'done';
    });

    expect(result).toBe('done');
    expect(await countRows(driver)).toBe(1);
    expect(driver.statements).toEqual([
      'CREATE TABLE t (x integer)',
      'BEGIN IMMEDIATE',
      'INSERT INTO t (x) VALUES (1)',
      'COMMIT',
      'SELECT count(*) AS n FROM t',
    ]);
  });

  it('rolls back the work of a callback that throws and rethrows its error', async () => {
    const driver = createMemoryDriver();
    await driver.query('CREATE TABLE t (x integer)');
    const failure = new Error('marker write failed');

    await expect(
      adapter.withTransaction(driver, async () => {
        await driver.query('INSERT INTO t (x) VALUES (1)');
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await countRows(driver)).toBe(0);
    expect(driver.statements.slice(1, 4)).toEqual([
      'BEGIN IMMEDIATE',
      'INSERT INTO t (x) VALUES (1)',
      'ROLLBACK',
    ]);
  });

  describe('when ROLLBACK itself fails', () => {
    const rollbackFailure = new Error('connection lost');
    const failingRollbackDriver = {
      familyId: 'sql' as const,
      targetId: 'sqlite' as const,
      async query<Row = Record<string, unknown>>(sql: string) {
        if (sql === 'ROLLBACK') throw rollbackFailure;
        return { rows: [] as Row[] };
      },
      async close() {},
    };

    it('rethrows the error that caused the rollback, with the rollback error as its cause', async () => {
      const failure = new Error('marker write failed');

      await expect(
        adapter.withTransaction(failingRollbackDriver, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(failure.cause).toBe(rollbackFailure);
    });

    it('keeps the cause the original error already has', async () => {
      const original = new Error('constraint violated');
      const failure = new Error('marker write failed', { cause: original });

      await expect(
        adapter.withTransaction(failingRollbackDriver, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(failure.cause).toBe(original);
    });
  });
});

describe('SqliteControlAdapter marker lock', () => {
  const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

  it('holds the database write lock from the start of the transaction, so the migration runner cannot begin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-sign-lock-'));
    const location = join(dir, 'db.sqlite');
    const signer = createMemoryDriver(location);
    const runner = new DatabaseSync(location);
    try {
      await signer.query('CREATE TABLE t (x integer)');

      await adapter.withTransaction(signer, async () => {
        await adapter.lockMarker(signer);
        expect(() => runner.exec('BEGIN EXCLUSIVE')).toThrow(/database is locked/);
      });
    } finally {
      runner.close();
      await signer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('issues no statement of its own, because the transaction already holds the lock', async () => {
    const driver = createMemoryDriver();

    await adapter.lockMarker(driver);

    expect(driver.statements).toEqual([]);
  });
});

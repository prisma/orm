import type { SqlDriver, SqlIsolationLevel } from '@internal/sql-relational-core/ast';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client, Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

const levels: ReadonlyArray<readonly [SqlIsolationLevel, string]> = [
  ['readUncommitted', 'read uncommitted'],
  ['readCommitted', 'read committed'],
  ['repeatableRead', 'repeatable read'],
  ['serializable', 'serializable'],
];

describe('@internal/driver-postgres transaction isolation level', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  async function createDirectDriver() {
    const database = await createDevDatabase();
    const client = new Client({ connectionString: database.connectionString });
    const driver = createBoundDriverFromBinding({ kind: 'pgClient', client }, undefined);
    cleanups.push(async () => {
      await driver.close();
      await database.close();
    });
    return { driver, client };
  }

  async function createPoolDriver() {
    const database = await createDevDatabase();
    const pool = new Pool({ connectionString: database.connectionString });
    const driver = createBoundDriverFromBinding({ kind: 'pgPool', pool }, undefined);
    cleanups.push(async () => {
      await driver.close();
      await database.close();
    });
    return { driver };
  }

  async function isolationInsideTransaction(
    driver: SqlDriver<unknown>,
    isolationLevel?: SqlIsolationLevel,
  ): Promise<string | undefined> {
    const connection = await driver.acquireConnection();
    try {
      const transaction = await connection.beginTransaction(
        isolationLevel === undefined ? undefined : { isolationLevel },
      );
      const rows = await queryRows<{ transaction_isolation: string }>(
        transaction,
        'show transaction_isolation',
      );
      await transaction.commit();
      return rows[0]?.transaction_isolation;
    } finally {
      await connection.release();
    }
  }

  it(
    'applies each requested level on a single-connection driver',
    async () => {
      const { driver } = await createDirectDriver();

      const applied: Array<[SqlIsolationLevel, string | undefined]> = [];
      for (const [level] of levels) {
        applied.push([level, await isolationInsideTransaction(driver, level)]);
      }

      expect(applied).toEqual(levels);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'applies the requested level on a pooled driver',
    async () => {
      const { driver } = await createPoolDriver();

      expect(await isolationInsideTransaction(driver, 'serializable')).toBe('serializable');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'keeps the database default when no level is requested',
    async () => {
      const { driver } = await createDirectDriver();

      expect(await isolationInsideTransaction(driver)).toBe('read committed');
      expect(await isolationInsideTransaction(driver, 'serializable')).toBe('serializable');
      expect(await isolationInsideTransaction(driver)).toBe('read committed');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'begins with one statement',
    async () => {
      const { driver, client } = await createDirectDriver();
      const connection = await driver.acquireConnection();
      const query = vi.spyOn(client, 'query');

      const plain = await connection.beginTransaction();
      await plain.rollback();
      const leveled = await connection.beginTransaction({ isolationLevel: 'repeatableRead' });
      await leveled.rollback();
      await connection.release();

      expect(query.mock.calls.map(([text]) => text)).toEqual([
        'BEGIN',
        'ROLLBACK',
        'BEGIN ISOLATION LEVEL REPEATABLE READ',
        'ROLLBACK',
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'rejects a level PostgreSQL does not have and sends nothing',
    async () => {
      const { driver, client } = await createDirectDriver();
      const connection = await driver.acquireConnection();
      const query = vi.spyOn(client, 'query');

      await expect(
        connection.beginTransaction({ isolationLevel: 'constructor' as SqlIsolationLevel }),
      ).rejects.toMatchObject({
        code: 'DRIVER.ISOLATION_LEVEL_UNSUPPORTED',
        details: { target: 'postgres', isolationLevel: 'constructor' },
      });
      expect(query).not.toHaveBeenCalled();

      await connection.release();
    },
    timeouts.spinUpPpgDev,
  );
});

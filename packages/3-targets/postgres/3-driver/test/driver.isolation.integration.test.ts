import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import driverDescriptor from '../src/exports/runtime';
import { queryRows } from './sql-queryable-test-utils';

describe.each(['pooled', 'direct'] as const)(
  '%s transaction isolation on the database',
  (transport) => {
    it(
      'uses selected isolation without changing the configured session baseline on reuse',
      async () => {
        const database = await createDevDatabase();
        const driver = driverDescriptor.create({ cursor: { disabled: true } });
        const pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
        const client = new pg.Client({ connectionString: database.connectionString });
        try {
          await driver.connect(
            transport === 'pooled'
              ? { kind: 'pgPool', pool, ownedByDriver: true }
              : { kind: 'pgClient', client, ownedByDriver: true },
          );
          const initial = await driver.acquireConnection();
          await initial.execute({ sql: "SET default_transaction_isolation = 'repeatable read'" });
          const [identity] = await queryRows<{ pid: number }>(
            initial,
            'SELECT pg_backend_pid() AS pid',
          );
          await initial.release();
          for (const [isolationLevel, reported] of [
            ['ReadUncommitted', 'read uncommitted'],
            ['ReadCommitted', 'read committed'],
            ['RepeatableRead', 'repeatable read'],
            ['Serializable', 'serializable'],
          ] as const) {
            const connection = await driver.acquireConnection();
            const transaction = await connection.beginTransaction({ isolationLevel });
            expect(await queryRows(transaction, 'SHOW transaction_isolation')).toEqual([
              { transaction_isolation: reported },
            ]);
            await transaction.commit();
            await connection.release();
            const reused = await driver.acquireConnection();
            expect(await queryRows(reused, 'SELECT pg_backend_pid() AS pid')).toEqual([identity]);
            const unconfigured = await reused.beginTransaction();
            expect(await queryRows(unconfigured, 'SHOW transaction_isolation')).toEqual([
              { transaction_isolation: 'repeatable read' },
            ]);
            await unconfigured.rollback();
            const implicit = await reused.beginTransaction(undefined);
            expect(await queryRows(implicit, 'SHOW transaction_isolation')).toEqual([
              { transaction_isolation: 'repeatable read' },
            ]);
            await implicit.commit();
            await reused.release();
          }
        } finally {
          await driver.close();
          await database.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  },
);

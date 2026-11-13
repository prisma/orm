import mysqlDriver from '@internal/driver-mysql/runtime';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import type { SqlTransactionOptions } from '@internal/sql-relational-core/ast';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import mysql from '../../src/runtime/mysql';
import { contractFromJson } from '../../src/static/contract-from-json';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };
import { exampleDatabase, withSeededDatabase } from './live-database';

const contract = contractFromJson<Contract>(contractJson);

function observeStarts(failure?: Error) {
  let pendingFailure = failure;
  const starts: (SqlTransactionOptions | undefined)[] = [];
  const destroyed: unknown[] = [];
  const create = mysqlDriver.create.bind(mysqlDriver);
  const spy = vi.spyOn(mysqlDriver, 'create').mockImplementation((...args) => {
    const driver = create(...args);
    const acquire = driver.acquireConnection.bind(driver);
    vi.spyOn(driver, 'acquireConnection').mockImplementation(async () => {
      const connection = await acquire();
      const begin = connection.beginTransaction.bind(connection);
      vi.spyOn(connection, 'beginTransaction').mockImplementation(async (start) => {
        starts.push(start);
        if (pendingFailure !== undefined) {
          const error = pendingFailure;
          pendingFailure = undefined;
          await connection.execute({ sql: 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE' });
          throw error;
        }
        return begin(start);
      });
      const destroy = connection.destroy.bind(connection);
      vi.spyOn(connection, 'destroy').mockImplementation(async (reason) => {
        destroyed.push(reason);
        await destroy(reason);
      });
      return connection;
    });
    return driver;
  });
  return { starts, destroyed, restore: () => spy.mockRestore() };
}

describe('MySQL facade transaction ownership', { timeout: timeouts.databaseOperation }, () => {
  it('uses implicit activity transactions for ORM read-back, participates in explicit transactions, and leaves manual starts unconfigured', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      const observed = observeStarts();
      try {
        await using db = mysql({
          contract,
          url,
          verifyMarker: false,
          poolOptions: { max: 1 },
          transactionOptions: { isolationLevel: 'Serializable' },
        });
        expect(
          await db.orm.User.select('id', 'email', 'role').create({
            id: 10,
            email: 'implicit@example.com',
            role: 'USER',
          }),
        ).toEqual({ id: 10, email: 'implicit@example.com', role: 'USER' });
        expect(observed.starts).toEqual([{ isolationLevel: 'ReadCommitted' }]);
        expect(
          await db.transaction(async (tx) =>
            tx.orm.User.select('id', 'email', 'role').create({
              id: 11,
              email: 'explicit@example.com',
              role: 'ADMIN',
            }),
          ),
        ).toEqual({ id: 11, email: 'explicit@example.com', role: 'ADMIN' });
        expect(observed.starts).toEqual([
          { isolationLevel: 'ReadCommitted' },
          { isolationLevel: 'Serializable' },
        ]);
        const held = await db.runtime().connection();
        try {
          const manual = await held.transaction();
          await manual.rollback();
        } finally {
          await held.release();
        }
        expect(observed.starts).toEqual([
          { isolationLevel: 'ReadCommitted' },
          { isolationLevel: 'Serializable' },
          undefined,
        ]);
        const pinned = await db.runtime().connection();
        try {
          const models = orm<Contract>({
            context: db.context,
            runtime: pinned,
            implicitTransactionOptions: { isolationLevel: 'ReadCommitted' },
          })[UNBOUND_NAMESPACE_ID];
          expect(
            await models.User.select('id', 'email', 'role').create({
              id: 12,
              email: 'held@example.com',
              role: 'USER',
            }),
          ).toEqual({ id: 12, email: 'held@example.com', role: 'USER' });
        } finally {
          await pinned.release();
        }
        expect(observed.starts).toEqual([
          { isolationLevel: 'ReadCommitted' },
          { isolationLevel: 'Serializable' },
          undefined,
          { isolationLevel: 'ReadCommitted' },
        ]);
      } finally {
        observed.restore();
      }
    });
  });

  it('destroys a callback-owned connection after failed setup with a pending next-transaction setting', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      const failure = new Error('BEGIN unavailable after SET');
      const observed = observeStarts(failure);
      try {
        await using db = mysql({ contract, url, verifyMarker: false, poolOptions: { max: 1 } });
        const identity = db.raw.sql`SELECT CONNECTION_ID() AS id`
          .returnsRow({ id: 'mysql/bigint@1' })
          .build();
        const before = await db.query(identity);
        const callback = vi.fn(async () => 42);
        await expect(db.transaction(callback, { isolationLevel: 'Serializable' })).rejects.toBe(
          failure,
        );
        expect(callback).not.toHaveBeenCalled();
        expect(observed.destroyed).toEqual([failure]);
        expect(await db.query(identity)).not.toEqual(before);
        expect(
          await db.transaction(async (tx) =>
            tx.orm.User.select('id', 'email', 'role').where({ id: 1 }).all(),
          ),
        ).toEqual([{ id: 1, email: 'b@example.com', role: 'ADMIN' }]);
        expect(observed.starts).toEqual([
          { isolationLevel: 'Serializable' },
          { isolationLevel: undefined },
        ]);
      } finally {
        observed.restore();
      }
    });
  });
});

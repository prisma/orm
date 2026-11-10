import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { SqliteTransactionOptions } from '../src/exports/runtime';

// No third-party mocks needed: node:sqlite (built-in) drives the real driver.

import sqlite from '../src/runtime/sqlite';

const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('sqlite-transaction-test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-transaction-test'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

describe('sqlite transaction isolation options', () => {
  it.each([
    [undefined, undefined, undefined],
    [{}, {}, undefined],
    [{ isolationLevel: undefined }, { isolationLevel: undefined }, undefined],
    [{ isolationLevel: 'Serializable' }, undefined, 'Serializable'],
    [{ isolationLevel: 'Serializable' }, {}, 'Serializable'],
    [{ isolationLevel: 'Serializable' }, { isolationLevel: undefined }, 'Serializable'],
    [undefined, { isolationLevel: 'Serializable' }, 'Serializable'],
  ] as const)('resolves global %j and local %j', async (global, local, isolationLevel) => {
    const db = sqlite({ contract, path: ':memory:', transactionOptions: global });
    const runtime = db.runtime();
    const open = runtime.connection.bind(runtime);
    const starts: unknown[] = [];
    vi.spyOn(runtime, 'connection').mockImplementation(async () => {
      const connection = await open();
      const begin = connection.transaction.bind(connection);
      vi.spyOn(connection, 'transaction').mockImplementation((start) => {
        starts.push(start);
        return begin(start);
      });
      return connection;
    });
    try {
      expect(await db.transaction(async () => 42, local)).toBe(42);
      const manual = await runtime.connection();
      await (await manual.transaction()).rollback();
      await manual.release();
      expect(starts).toEqual([{ kind: 'explicit', isolationLevel }, undefined]);
    } finally {
      await db.close();
    }
  });

  const invalid = [
    null,
    1,
    'Serializable',
    { isolationLevel: null },
    { isolationLevel: 1 },
    { isolationLevel: 'ReadCommitted' },
    { isolationLevel: 'ReadUncommitted' },
    { isolationLevel: 'RepeatableRead' },
    { isolationLevel: 'Serializable; SELECT 1' },
    { isolationLevel: 'Serializable', extra: true },
  ];

  it.each(invalid)(
    'rejects invalid factory options %j before constructing the runtime',
    (value) => {
      expect(() =>
        sqlite({ contract, transactionOptions: value as SqliteTransactionOptions }),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ARGUMENT_INVALID',
          why: expect.any(String),
          fix: expect.any(String),
        }),
      );
    },
  );

  it.each(invalid)('rejects invalid callback options %j before acquisition', async (value) => {
    const db = sqlite({ contract, path: ':memory:' });
    const acquire = vi.spyOn(db.runtime(), 'connection');
    const callback = vi.fn(async () => 42);
    try {
      await expect(async () =>
        db.transaction(callback, value as SqliteTransactionOptions),
      ).rejects.toMatchObject({
        code: 'RUNTIME.ARGUMENT_INVALID',
        why: expect.any(String),
        fix: expect.any(String),
      });
      expect(acquire).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
});

describe('sqlite transaction()', () => {
  it("offers the client's toSql", async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const toSql = await db.transaction(async (tx) => tx.toSql);
    await db.close();

    expect(toSql).toBe(db.toSql);
  });

  it('transaction() runs the callback and returns its result', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const result = await db.transaction(async () => 'tx-value');

    expect(result).toBe('tx-value');
    await db.close();
  });

  it('transaction() provides sql on the transaction context', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    let receivedTx: { sql?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.sql).toBeDefined();
    await db.close();
  });

  it('transaction() provides orm on the transaction context', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    let receivedTx: { orm?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.orm).toBeDefined();
    await db.close();
  });

  it('transaction() lazily creates runtime on first use', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async () => 'value');

    expect(db.runtime()).toBeDefined();
    await db.close();
  });

  it('rejects escaped queries and delayed prepared rows after callback completion', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    try {
      const plan = planFromAst<{ id: number }>(
        RawQueryAst.rows(['select 1 as id'], {
          id: { codecId: 'sqlite/integer@1', nullable: false },
        }),
        db.contract,
      );
      const prepared = await db.prepare({}, () => plan);
      const escaped = await db.transaction(async (tx) => {
        expect(await tx.query(plan)).toEqual([{ id: 1 }]);
        expect(await prepared.query(tx, {})).toEqual([{ id: 1 }]);
        return {
          tx,
          rows: tx.query(plan),
          preparedRows: prepared.query(tx, {}),
        };
      });

      await expect(escaped.tx.query(plan).toArray()).rejects.toThrow(/transaction has ended/);
      await expect(prepared.query(escaped.tx, {}).toArray()).rejects.toThrow(
        /transaction has ended/,
      );
      await expect(escaped.rows.toArray()).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
      await expect(escaped.preparedRows.toArray()).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
    } finally {
      await db.close();
    }
  });

  it('transaction() rejects with "SQLite client is closed" after close()', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.close();

    await expect(db.transaction(async () => 'value')).rejects.toThrow('SQLite client is closed');
  });
});

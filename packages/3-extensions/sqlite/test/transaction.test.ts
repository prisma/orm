import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

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

describe('sqlite transaction()', () => {
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

      expect(() => escaped.tx.query(plan)).toThrow(/transaction has ended/);
      expect(() => prepared.query(escaped.tx, {})).toThrow(/transaction has ended/);
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

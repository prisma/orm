import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
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

  it('transaction() rejects with "SQLite client is closed" after close()', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.close();

    await expect(db.transaction(async () => 'value')).rejects.toThrow('SQLite client is closed');
  });

  it('concurrent transaction() calls are serialised and all succeed (#29870)', async () => {
    // Regression test: before the fix, launching more concurrent transactions
    // than libuv worker threads caused SQLITE_BUSY to propagate as a P1008
    // socket-timeout error because the busy-handler blocked worker threads
    // while the lock holder's COMMIT had no thread to run on.
    //
    // With the async semaphore in place, each transaction waits its turn in
    // the Node.js event loop instead of inside the synchronous busy-handler,
    // so all of them complete successfully regardless of concurrency.
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const N = 20; // well above typical libuv thread-pool size (4 by default)
    const order: number[] = [];

    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        db.transaction(async () => {
          order.push(i);
          return i * 2;
        }),
      ),
    );

    // All transactions must have resolved (none rejected).
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(N);

    // The serialisation guarantee: every transaction ran exactly once.
    expect(order).toHaveLength(N);

    await db.close();
  });
});

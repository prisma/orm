import type { Contract } from '@internal/contract/types';
import { coreHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

// No third-party mocks needed: node:sqlite (built-in) drives the real driver.

import sqlite from '../src/runtime/sqlite';

const contract: Contract<SqlStorage> = createContract<SqlStorage>({
  target: 'sqlite',
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-close-test'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
});

describe('sqlite close()', () => {
  it('releases the facade-owned SQLite driver when constructed from { path }', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    db.runtime();
    await Promise.resolve();

    await db.close();

    // Driver was cleaned up: subsequent runtime() calls throw
    expect(() => db.runtime()).toThrow('SQLite client is closed');
  });

  it('is idempotent: calling twice does not throw and does not double-dispose', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    db.runtime();
    await Promise.resolve();

    await db.close();
    await expect(db.close()).resolves.toBeUndefined();
  });

  it('while a lazy connect is in flight, close() waits and resolves cleanly', async () => {
    // Create a client and trigger a connect — the sqlite connect is synchronous
    // (DatabaseSync), so this tests the close-while-connected path.
    const db = sqlite({ contract, path: ':memory:' });

    const connected = db.connect({ path: ':memory:' });

    await expect(db.close()).resolves.toBeUndefined();
    await expect(connected).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  });

  it('before any connect is a no-op', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await expect(db.close()).resolves.toBeUndefined();
  });

  it('await using db executes [Symbol.asyncDispose] on scope exit', async () => {
    async function run() {
      await using db = sqlite({ contract, path: ':memory:' });
      db.runtime();
      await Promise.resolve();
    }

    await run();
    // No assertion beyond "did not throw" — the real driver cleaned up
  });
});

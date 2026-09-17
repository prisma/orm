import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { withTransaction } from '@prisma/orm-sqlite/family-runtime';
import sqlite from '@prisma/orm-sqlite/runtime';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { createSchema, seedData } from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');
const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as unknown;

interface TestHandle {
  db: ReturnType<typeof sqlite<Contract>>;
  rawDb: DatabaseSync;
  testDir: string;
}

function setupHandle(): TestHandle {
  const testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-tx-e2e-'));
  const dbPath = join(testDir, 'test.db');
  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec('PRAGMA foreign_keys = ON');

  const db = sqlite<Contract>({ contractJson, path: dbPath });

  return { db, rawDb, testDir };
}

async function teardownHandle(handle: TestHandle): Promise<void> {
  try {
    await handle.db.close();
  } finally {
    try {
      handle.rawDb.close();
    } finally {
      rmSync(handle.testDir, { recursive: true, force: true });
    }
  }
}

describe('transaction e2e via sqlite() facade', { timeout: timeouts.databaseOperation }, () => {
  let handle: TestHandle;

  beforeEach(async () => {
    handle = setupHandle();
    // Schema and seed via the raw DatabaseSync handle before connecting the facade.
    const { rawDb, db } = handle;
    createSchema(rawDb, db.contract);
    seedData(rawDb);
    // Connect the facade and warm up the runtime before any transactions.
    // SQLite uses a single connection; contract verification acquires its own
    // connection internally. Running one read first ensures verification
    // completes before we open a transaction, avoiding a potential deadlock.
    await db.connect();
    await db.orm.User.first();
  });

  afterEach(async () => {
    await teardownHandle(handle);
  });

  it('commits multiple writes atomically on success', async () => {
    const { db, rawDb } = handle;

    await db.transaction(async (tx) => {
      await tx.orm.User.create({ id: 100, name: 'TxUser1', email: 'tx1@example.com' });
      await tx.orm.User.create({ id: 101, name: 'TxUser2', email: 'tx2@example.com' });
    });

    // Verify both rows are visible from outside the facade via the raw handle.
    const rows = rawDb
      .prepare('SELECT id FROM users WHERE id IN (100, 101) ORDER BY id')
      .all() as Array<{ id: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(100);
    expect(rows[1]!.id).toBe(101);
  });

  it('rolls back all writes and rethrows the callback error', async () => {
    const { db, rawDb } = handle;

    await expect(
      db.transaction(async (tx) => {
        await tx.orm.User.create({ id: 200, name: 'RollbackUser', email: 'rollback@example.com' });
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    // The write must not be visible from outside after rollback.
    const rows = rawDb.prepare('SELECT id FROM users WHERE id = 200').all() as Array<{
      id: number;
    }>;
    expect(rows).toHaveLength(0);
  });

  it('ORM write then read inside a transaction uses the transaction scope (read-your-own-write)', async () => {
    const { db, rawDb } = handle;

    await db.transaction(async (tx) => {
      const created = await tx.orm.User.create({
        id: 300,
        name: 'RYOW',
        email: 'ryow@example.com',
      });

      // Read back inside the same transaction — must see the uncommitted row.
      const found = await tx.orm.User.where({ id: 300 }).first();
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.email).toBe('ryow@example.com');
    });

    // Confirm the row is also visible after commit.
    const rows = rawDb.prepare('SELECT id FROM users WHERE id = 300').all() as Array<{
      id: number;
    }>;
    expect(rows).toHaveLength(1);
  });

  it('rejects a requested isolation level and leaves the database usable', async () => {
    const { db, rawDb } = handle;

    await expect(
      withTransaction(db.runtime(), async () => undefined, { isolationLevel: 'serializable' }),
    ).rejects.toMatchObject({ code: 'DRIVER.ISOLATION_LEVEL_UNSUPPORTED' });

    await db.transaction(async (tx) => {
      await tx.orm.User.create({ id: 300, name: 'AfterReject', email: 'after@example.com' });
    });
    expect(rawDb.prepare('SELECT name FROM users WHERE id = 300').all()).toEqual([
      { name: 'AfterReject' },
    ]);
  });

  it('escaped AsyncIterableResult rejects with TRANSACTION_CLOSED after the transaction has ended', async () => {
    const { db } = handle;

    // Capture the result inside the callback WITHOUT awaiting it, then return
    // it so we can consume it after the transaction ends.
    const escaped = await db.transaction(async (tx) => {
      await tx.orm.User.create({ id: 400, name: 'EscapeUser', email: 'escape@example.com' });
      // Build a query plan through tx.sql and call tx.query to get an
      // AsyncIterableResult; do not await it — just capture the reference.
      return { rows: tx.query(tx.sql.users.select('id').build()) };
    });

    await expect(escaped.rows.toArray()).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_CLOSED',
    });
  });
});

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction } from '@prisma/orm-postgres/family-runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('transaction E2E', { timeout: 30000 }, () => {
  it('commits both writes atomically', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime, client }) => {
      await withTransaction(runtime, async (tx) => {
        await tx.execute(db.public.user.insert([{ email: 'tx-user-1@example.com' }]).build());
        await tx.execute(db.public.user.insert([{ email: 'tx-user-2@example.com' }]).build());
      });

      const result = await client.query(
        `SELECT email FROM "user" WHERE email IN ('tx-user-1@example.com', 'tx-user-2@example.com') ORDER BY email`,
      );
      expect(result.rows).toEqual([
        { email: 'tx-user-1@example.com' },
        { email: 'tx-user-2@example.com' },
      ]);
    });
  });

  it('runs no statement between BEGIN and the first user statement on a fresh runtime', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ raw, runtime }) => {
      const level = await withTransaction(runtime, async (tx) => {
        await tx.execute(
          raw.sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`.affectedCount().build(),
        );
        return tx.query(
          raw.sql`SHOW transaction_isolation`
            .returnsRow({ transaction_isolation: 'pg/text@1' })
            .build(),
        );
      });

      expect(level).toEqual([{ transaction_isolation: 'serializable' }]);
    });
  });

  it('rolls back all writes on error', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime, client }) => {
      await expect(
        withTransaction(runtime, async (tx) => {
          await tx.execute(db.public.user.insert([{ email: 'tx-rollback@example.com' }]).build());
          throw new Error('deliberate rollback');
        }),
      ).rejects.toThrow('deliberate rollback');

      const result = await client.query(
        `SELECT email FROM "user" WHERE email = 'tx-rollback@example.com'`,
      );
      expect(result.rows).toEqual([]);
    });
  });

  it('forwards the callback return value after commit', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
      const result = await withTransaction(runtime, async (tx) => {
        await tx.execute(db.public.user.insert([{ email: 'tx-return@example.com' }]).build());
        return { inserted: true };
      });

      expect(result).toEqual({ inserted: true });
    });
  });

  it('collects returned stream before commit', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
      const result = await withTransaction(runtime, async (tx) => {
        await tx.execute(db.public.user.insert([{ email: 'tx-user-1@example.com' }]).build());
        await tx.execute(db.public.user.insert([{ email: 'tx-user-2@example.com' }]).build());
        return tx.query(db.public.user.select('email').build());
      });

      expect(result).toEqual([
        { email: 'tx-user-1@example.com' },
        { email: 'tx-user-2@example.com' },
      ]);
    });
  });

  it('rejects escaped AsyncIterableResult consumed after commit', async () => {
    await withTestRuntime<Contract>(contractJsonPath, async ({ db, runtime }) => {
      const escaped = await withTransaction(runtime, async (tx) => {
        await tx.execute(db.public.user.insert([{ email: 'tx-escape@example.com' }]).build());
        return { rows: tx.query(db.public.user.select('email').build()) };
      });

      await expect(escaped.rows.toArray()).rejects.toThrow(
        'Cannot use a transaction operation after the transaction has ended',
      );
    });
  });
});

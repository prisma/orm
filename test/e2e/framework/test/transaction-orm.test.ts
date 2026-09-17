import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import arktypeJson from '@prisma/orm-extension-arktype-json/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { runDbInit } from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

function v(s: string): Varchar<255> {
  return s as Varchar<255>;
}

async function loadContractJson(): Promise<unknown> {
  const content = await readFile(contractJsonPath, 'utf-8');
  return JSON.parse(content);
}

async function withPostgresClient(
  callback: (db: ReturnType<typeof postgres<Contract>>) => Promise<void>,
): Promise<void> {
  const contractJson = await loadContractJson();
  await withDevDatabase(async ({ connectionString }) => {
    await runDbInit({ connectionString, contractJsonPath });
    const db = postgres<Contract>({
      contractJson,
      url: connectionString,
      extensions: [pgvector, arktypeJson],
    });
    let runtime: Runtime | undefined;
    try {
      runtime = await db.connect();

      await callback(db);
    } finally {
      await runtime?.close();
    }
  });
}

describe('transaction ORM integration', { timeout: timeouts.spinUpPpgDev }, () => {
  it('ORM create with nested relation mutation commits atomically', async () => {
    await withPostgresClient(async (db) => {
      await db.transaction(async (tx) => {
        await tx.orm.public.Post.create({
          title: 'Atomic Post',
          published: true,
          author: (r) => r.create({ email: v('nested-author@example.com') }),
        });
      });

      const user = await db.orm.public.User.where({
        email: v('nested-author@example.com'),
      }).first();
      expect(user).not.toBeNull();

      const post = await db.orm.public.Post.where({ title: 'Atomic Post' }).first();
      expect(post).not.toBeNull();
      expect(post!.published).toBe(true);
      expect(post!.userId).toBe(user!.id);
    });
  });

  it('db.transaction runs the callback at the requested isolation level', async () => {
    await withPostgresClient(async (db) => {
      const showIsolation = db.raw.sql`SHOW transaction_isolation`
        .returnsRow({ transaction_isolation: 'pg/text@1' })
        .build();

      const level = await db.transaction(
        async (tx) => {
          await tx.orm.public.User.create({ email: v('isolation-level@example.com') });
          return tx.query(showIsolation);
        },
        { isolationLevel: 'repeatableRead' },
      );

      expect(level).toEqual([{ transaction_isolation: 'repeatable read' }]);
    });
  });

  it('ORM create with nested relation mutation rolls back everything on throw', async () => {
    await withPostgresClient(async (db) => {
      await expect(
        db.transaction(async (tx) => {
          await tx.orm.public.Post.create({
            title: 'Rollback Post',
            published: false,
            author: (r) => r.create({ email: v('rollback-author@example.com') }),
          });

          throw new Error('deliberate rollback');
        }),
      ).rejects.toThrow('deliberate rollback');

      const user = await db.orm.public.User.where({
        email: v('rollback-author@example.com'),
      }).first();
      expect(user).toBeNull();

      const post = await db.orm.public.Post.where({ title: 'Rollback Post' }).first();
      expect(post).toBeNull();
    });
  });

  it('ORM write then read within the same transaction uses the transaction connection', async () => {
    await withPostgresClient(async (db) => {
      await db.transaction(async (tx) => {
        const created = await tx.orm.public.User.create({ email: v('tx-ryow@example.com') });

        const found = await tx.orm.public.User.where({ email: v('tx-ryow@example.com') }).first();
        expect(found).not.toBeNull();
        expect(found!.id).toBe(created.id);
        expect(found!.email).toBe('tx-ryow@example.com');
      });

      const user = await db.orm.public.User.where({ email: v('tx-ryow@example.com') }).first();
      expect(user).not.toBeNull();
    });
  });

  it('multiple ORM operations in a transaction are atomic', async () => {
    await withPostgresClient(async (db) => {
      await db.transaction(async (tx) => {
        const user = await tx.orm.public.User.create({ email: v('multi-op@example.com') });

        await tx.orm.public.Post.create({
          title: 'First Post',
          userId: user.id,
          published: true,
        });

        await tx.orm.public.Post.create({
          title: 'Second Post',
          userId: user.id,
          published: false,
        });
      });

      const user = await db.orm.public.User.where({ email: v('multi-op@example.com') }).first();
      expect(user).not.toBeNull();

      const posts = await db.orm.public.Post.where({ userId: user!.id })
        .orderBy((p) => p.title.asc())
        .all();
      expect(posts).toHaveLength(2);
      expect(posts[0]!.title).toBe('First Post');
      expect(posts[1]!.title).toBe('Second Post');
    });
  });

  it('multiple ORM operations roll back together on throw', async () => {
    await withPostgresClient(async (db) => {
      await expect(
        db.transaction(async (tx) => {
          const user = await tx.orm.public.User.create({ email: v('multi-rollback@example.com') });

          await tx.orm.public.Post.create({
            title: 'Doomed Post',
            userId: user.id,
            published: true,
          });

          throw new Error('rollback everything');
        }),
      ).rejects.toThrow('rollback everything');

      const user = await db.orm.public.User.where({
        email: v('multi-rollback@example.com'),
      }).first();
      expect(user).toBeNull();

      const post = await db.orm.public.Post.where({ title: 'Doomed Post' }).first();
      expect(post).toBeNull();
    });
  });
});

import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres, { type PostgresTransactionContext } from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const options = { contract, verifyMarker: false as const };

type Queryable = Pick<PostgresTransactionContext<Contract>, 'raw' | 'execute' | 'query'>;

const insert = (q: Queryable, name: string) =>
  q.execute(q.raw.sql`INSERT INTO nested_rows (name) VALUES (${name})`.affectedCount().build());

const failingStatement = (q: Queryable) =>
  q.execute(q.raw.sql`SELECT 1 / 0`.affectedCount().build());

const names = async (q: Queryable) =>
  (
    await q
      .query(
        q.raw.sql`SELECT name FROM nested_rows ORDER BY name`
          .returnsRow({ name: 'pg/text@1' })
          .build(),
      )
      .toArray()
  ).map((row) => row.name);

const createWithAuthor = (
  tx: PostgresTransactionContext<Contract>,
  id: number,
  title: string,
  authorId: number,
) =>
  tx.orm.public.Post.select('id').create({
    id,
    title,
    views: 0,
    author: (author) => author.create({ id: authorId, email: `${title}@example.com`, name: title }),
  });

describe('tx.transaction on postgres', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let pool: pg.Pool;
  let db: ReturnType<typeof postgres<Contract>>;

  beforeAll(async () => {
    database = await createDevDatabase();
    pool = new pg.Pool({ connectionString: database.connectionString, max: 1 });
    db = postgres({ ...options, pg: pool });
    await db.execute(
      db.raw.sql`CREATE TABLE nested_rows (name TEXT NOT NULL)`.affectedCount().build(),
    );
    await db.execute(
      db.raw
        .sql`CREATE TABLE users (id INT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, invited_by_id INT)`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw
        .sql`CREATE TABLE posts (id INT PRIMARY KEY, title TEXT NOT NULL, user_id INT NOT NULL, views INT NOT NULL)`
        .affectedCount()
        .build(),
    );
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await db.close();
    await pool.end();
    await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    await db.execute(db.raw.sql`DELETE FROM nested_rows`.affectedCount().build());
    await db.execute(db.raw.sql`DELETE FROM posts`.affectedCount().build());
    await db.execute(db.raw.sql`DELETE FROM users`.affectedCount().build());
  });

  it.each(['pooled', 'serverless'] as const)(
    'commits the work around a nested transaction that threw, and not the work inside it, on a %s client',
    async (transport) => {
      const client =
        transport === 'pooled'
          ? db
          : await postgresServerless(options).connect({ url: database.connectionString });
      try {
        await client.transaction(async (tx) => {
          await insert(tx, 'A');
          await tx
            .transaction(async (inner) => {
              await insert(inner, 'B');
              throw new Error('nope');
            })
            .catch(() => undefined);
          await insert(tx, 'C');
        });
      } finally {
        if (client !== db) await client.close();
      }

      expect(await names(db)).toEqual(['A', 'C']);
    },
  );

  it('rejects with the database error of a failed statement and lets the outer transaction commit', async () => {
    await db.transaction(async (tx) => {
      await expect(tx.transaction((inner) => failingStatement(inner))).rejects.toThrow(
        /division by zero/,
      );
      await insert(tx, 'C');
    });

    expect(await names(db)).toEqual(['C']);
  });

  it('rejects with RUNTIME.TRANSACTION_COMMIT_FAILED when the callback caught a failed statement, and lets the outer transaction commit', async () => {
    await db.transaction(async (tx) => {
      await expect(
        tx.transaction(async (inner) => {
          await insert(inner, 'B');
          await failingStatement(inner).catch(() => undefined);
        }),
      ).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_COMMIT_FAILED' });
      await insert(tx, 'C');
    });

    expect(await names(db)).toEqual(['C']);
  });

  it('suspends a second nested transaction and statements on tx while a nested callback runs', async () => {
    await db.transaction(async (tx) => {
      const results = await Promise.allSettled([
        tx.transaction((inner) => insert(inner, 'A')),
        tx.transaction((inner) => insert(inner, 'B')),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect(results[1]).toMatchObject({ reason: { code: 'RUNTIME.TRANSACTION_SUSPENDED' } });

      await tx.transaction(async (inner) => {
        await expect(insert(tx, 'X')).rejects.toMatchObject({
          code: 'RUNTIME.TRANSACTION_SUSPENDED',
        });
        await insert(inner, 'B');
      });
      await insert(tx, 'C');
    });

    expect(await names(db)).toEqual(['A', 'B', 'C']);
  });

  it('rolls back the innermost of three nested transactions and commits the middle and outer ones', async () => {
    await db.transaction(async (tx) => {
      await insert(tx, 'A');
      await tx.transaction(async (middle) => {
        await insert(middle, 'B');
        await middle
          .transaction(async (inner) => {
            await insert(inner, 'C');
            throw new Error('nope');
          })
          .catch(() => undefined);
      });
    });

    expect(await names(db)).toEqual(['A', 'B']);
  });

  it('runs an ORM write of several statements in a savepoint, so a failed write leaves none of its rows and the transaction commits', async () => {
    await db.transaction(async (tx) => {
      await createWithAuthor(tx, 1, 'A', 1);
      await expect(createWithAuthor(tx, 1, 'B', 2)).rejects.toThrow(/duplicate key value/);
      await createWithAuthor(tx, 3, 'C', 3);
    });

    expect({
      posts: await db.orm.public.Post.select('id', 'title', 'userId')
        .orderBy((post) => post.id.asc())
        .all(),
      users: await db.orm.public.User.select('id', 'name')
        .orderBy((user) => user.id.asc())
        .all(),
    }).toEqual({
      posts: [
        { id: 1, title: 'A', userId: 1 },
        { id: 3, title: 'C', userId: 3 },
      ],
      users: [
        { id: 1, name: 'A' },
        { id: 3, name: 'C' },
      ],
    });
  });

  it('rejects with RUNTIME.TRANSACTION_ROLLBACK_FAILED when the callback throws while an ORM write it did not await holds a savepoint, and leaves no rows', async () => {
    const run = db.transaction(async (tx) => {
      await insert(tx, 'before');
      await Promise.all([createWithAuthor(tx, 1, 'A', 1), tx.orm.public.User.select('id').all()]);
    });

    await expect(run).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
      cause: { code: 'RUNTIME.TRANSACTION_SUSPENDED' },
      details: { rollbackError: { code: 'RUNTIME.TRANSACTION_SUSPENDED' } },
    });
    await db.transaction(async (tx) => insert(tx, 'next'));
    expect({
      names: await names(db),
      posts: await db.orm.public.Post.select('id').all(),
      users: await db.orm.public.User.select('id').all(),
    }).toEqual({ names: ['next'], posts: [], users: [] });
  });

  it('suspends only the other work when the callback waits for an ORM write with Promise.allSettled, and the transaction commits', async () => {
    await db.transaction(async (tx) => {
      const [write, read] = await Promise.allSettled([
        createWithAuthor(tx, 1, 'A', 1),
        tx.orm.public.User.select('id').all(),
      ]);
      expect({ write: write.status, read }).toMatchObject({
        write: 'fulfilled',
        read: { status: 'rejected', reason: { code: 'RUNTIME.TRANSACTION_SUSPENDED' } },
      });
      await insert(tx, 'after');
    });

    expect({
      names: await names(db),
      posts: await db.orm.public.Post.select('id').all(),
    }).toEqual({ names: ['after'], posts: [{ id: 1 }] });
  });
});

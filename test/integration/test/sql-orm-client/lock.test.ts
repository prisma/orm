import { Collection } from '@internal/sql-orm-client';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { getPolyTestContext, getTestContext } from './helpers';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import { type PgIntegrationRuntime, seedPosts, seedUsers } from './runtime-helpers';

async function inTransaction<T>(
  runtime: PgIntegrationRuntime,
  fn: (tx: RuntimeScope) => Promise<T>,
): Promise<T> {
  const connection = await runtime.connection?.();
  if (connection === undefined) {
    throw new Error('the integration runtime opens no connection');
  }
  try {
    const tx = await connection.transaction?.();
    if (tx?.rollback === undefined) {
      throw new Error('the integration runtime opens no transaction it can roll back');
    }
    try {
      return await fn(tx);
    } finally {
      await tx.rollback();
    }
  } finally {
    await connection.release?.();
  }
}

const usersIn = (tx: RuntimeScope) =>
  new Collection({ runtime: tx, context: getTestContext() }, 'User', { namespaceId: 'public' });
const postsIn = (tx: RuntimeScope) =>
  new Collection({ runtime: tx, context: getTestContext() }, 'Post', { namespaceId: 'public' });

const alice = {
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  invitedById: null,
  address: null,
};

const aliceSql =
  'SELECT "users"."address" AS "address", "users"."email" AS "email", "users"."id" AS "id", "users"."invited_by_id" AS "invited_by_id", "users"."name" AS "name" FROM "public"."users" WHERE "users"."id" = $1 LIMIT 1';

async function seed(runtime: PgIntegrationRuntime): Promise<void> {
  await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
  await seedPosts(runtime, [
    { id: 1, title: 'Hello World', userId: 1, views: 100 },
    { id: 2, title: 'Second Post', userId: 1, views: 50 },
    { id: 3, title: 'Quiet Post', userId: 1, views: 10 },
  ]);
}

async function lockedByThisTransaction(runtime: PgIntegrationRuntime): Promise<unknown> {
  return await runtime.query(
    'select xmax::text = (pg_current_xact_id()::text::bigint % 4294967296)::text as locked from users where id = 1',
  );
}

const lastSql = (runtime: PgIntegrationRuntime) => runtime.executions.at(-1)?.sql;

describe('integration: Postgres accepts each row-locking clause the ORM renders', () => {
  it.each([
    ['forUpdate', 'FOR UPDATE'],
    ['forNoKeyUpdate', 'FOR NO KEY UPDATE'],
    ['forShare', 'FOR SHARE'],
    ['forKeyShare', 'FOR KEY SHARE'],
  ] as const)(
    '%s renders %s OF the model table and Postgres returns the row',
    async (method, keyword) => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);

        const row = await inTransaction(runtime, (tx) =>
          usersIn(tx).where({ id: 1 })[method]().first(),
        );

        expect(lastSql(runtime)).toBe(`${aliceSql} ${keyword} OF "users"`);
        expect(row).toEqual(alice);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'nowait and skipLocked render and Postgres returns the row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);

        const nowait = await inTransaction(runtime, (tx) =>
          usersIn(tx).where({ id: 1 }).forUpdate({ nowait: true }).first(),
        );
        expect(lastSql(runtime)).toBe(`${aliceSql} FOR UPDATE OF "users" NOWAIT`);
        const skipLocked = await inTransaction(runtime, (tx) =>
          usersIn(tx).where({ id: 1 }).forUpdate({ skipLocked: true }).first(),
        );
        expect(lastSql(runtime)).toBe(`${aliceSql} FOR UPDATE OF "users" SKIP LOCKED`);

        expect([nowait, skipLocked]).toEqual([alice, alice]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'the work-queue shape claims one row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);

        const job = await inTransaction(runtime, (tx) =>
          postsIn(tx)
            .where((post) => post.views.gt(40))
            .orderBy((post) => post.views.asc())
            .limit(1)
            .forUpdate({ skipLocked: true })
            .first(),
        );

        expect(lastSql(runtime)).toBe(
          'SELECT "posts"."embedding" AS "embedding", "posts"."id" AS "id", "posts"."title" AS "title", "posts"."user_id" AS "user_id", "posts"."views" AS "views" FROM "public"."posts" WHERE "posts"."views" > $1 ORDER BY "posts"."views" ASC LIMIT 1 FOR UPDATE OF "posts" SKIP LOCKED',
        );
        expect(job).toEqual({ id: 2, title: 'Second Post', userId: 1, views: 50, embedding: null });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'the transaction holds the row lock after a forUpdate read',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);

        const locked = await inTransaction(runtime, async (tx) => {
          await usersIn(tx).where({ id: 1 }).forUpdate().first();
          return await lockedByThisTransaction(runtime);
        });

        expect(locked).toEqual([{ locked: true }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'the transaction holds no row lock after a plain read',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);

        const locked = await inTransaction(runtime, async (tx) => {
          await usersIn(tx).where({ id: 1 }).first();
          return await lockedByThisTransaction(runtime);
        });

        expect(locked).toEqual([{ locked: false }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a polymorphic base query locks the base table, not the outer-joined variant table',
    async () => {
      const polyContext = getPolyTestContext();
      await withCollectionRuntime(async (runtime) => {
        await runtime.query('drop table if exists features');
        await runtime.query('drop table if exists epics');
        await runtime.query('drop table if exists tasks');
        await runtime.query(
          'create table tasks (id serial primary key, title text not null, type text not null, severity text, project_id integer, reporter_id integer, bug_assignee_person_id integer)',
        );
        await runtime.query(
          'create table features (id integer primary key references tasks(id), priority integer not null, feature_assignee_person_id integer)',
        );
        await runtime.query(
          'create table epics (id integer primary key references tasks(id), scope text not null)',
        );
        await runtime.query(
          "insert into tasks (id, title, type) values (3, 'Dark mode', 'feature')",
        );
        await runtime.query('insert into features (id, priority) values (3, 1)');

        const rows = await inTransaction(runtime, (tx) =>
          new Collection({ runtime: tx, context: polyContext }, 'Task', { namespaceId: 'public' })
            .forUpdate()
            .all()
            .toArray(),
        );

        expect(lastSql(runtime)).toBe(
          'SELECT "tasks"."bug_assignee_person_id" AS "bug_assignee_person_id", "tasks"."id" AS "id", "tasks"."project_id" AS "project_id", "tasks"."reporter_id" AS "reporter_id", "tasks"."severity" AS "severity", "tasks"."title" AS "title", "tasks"."type" AS "type", "epics"."scope" AS "epics__scope", "features"."feature_assignee_person_id" AS "features__feature_assignee_person_id", "features"."priority" AS "features__priority" FROM "public"."tasks" LEFT JOIN "public"."epics" ON "tasks"."id" = "epics"."id" LEFT JOIN "public"."features" ON "tasks"."id" = "features"."id" FOR UPDATE OF "tasks"',
        );
        expect(rows).toEqual([
          {
            id: 3,
            title: 'Dark mode',
            type: 'feature',
            projectId: null,
            reporterId: null,
            priority: 1,
            assigneeId: null,
          },
        ]);
      }, polyContext.contract);
    },
    timeouts.spinUpPpgDev,
  );
});

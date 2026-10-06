import { Collection } from '@internal/sql-orm-client';
import {
  type SqlMiddleware,
  type TransactionContext,
  withTransaction,
} from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import { getTestContext } from './helpers';
import {
  createReturningUsersCollection,
  createUsersCollection,
  createUsersCollectionWithoutReturning,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

function recordAfterTransaction(stages: string[]): SqlMiddleware {
  return {
    name: 'after-transaction-recorder',
    familyId: 'sql',
    async afterTransaction(_exec, result) {
      stages.push(result.outcome);
    },
  };
}

function usersIn(tx: TransactionContext) {
  return new Collection({ runtime: tx, context: getTestContext() }, 'User', {
    namespaceId: 'public',
  });
}

describe('integration/update', () => {
  it(
    'updateAndCount() returns matched row count and updates data',
    async () => {
      const observedStatements: string[] = [];
      const observer: SqlMiddleware = {
        name: 'update-count-observer',
        familyId: 'sql',
        beforeExecute(exec) {
          observedStatements.push(exec.sql);
        },
      };
      await withCollectionRuntime(
        async (runtime) => {
          const users = createUsersCollection(runtime);

          await seedUsers(runtime, [
            { id: 1, name: 'Stale', email: 'a@example.com' },
            { id: 2, name: 'Stale', email: 'b@example.com' },
            { id: 3, name: 'Fresh', email: 'c@example.com' },
          ]);
          observedStatements.length = 0;

          const count = await users.where({ name: 'Stale' }).updateAndCount({ name: 'Updated' });
          expect(count).toBe(2);
          expect(observedStatements).toHaveLength(1);
          expect(observedStatements[0]?.toLowerCase()).toContain('update');

          const rows = await runtime.query<{ id: number; name: string }>(
            'select id, name from users order by id',
          );
          expect(rows).toEqual([
            { id: 1, name: 'Updated' },
            { id: 2, name: 'Updated' },
            { id: 3, name: 'Fresh' },
          ]);
        },
        undefined,
        [],
        [observer],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() affects only one row even when where() matches several',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Stale', email: 'a@example.com' },
          { id: 2, name: 'Stale', email: 'b@example.com' },
          { id: 3, name: 'Fresh', email: 'c@example.com' },
        ]);

        const returned = await users.where({ name: 'Stale' }).update({ name: 'Updated' });

        expect(returned).not.toBeNull();
        expect(returned?.name).toBe('Updated');
        expect([1, 2]).toContain(returned?.id);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        const updatedRows = rows.filter((row) => row.name === 'Updated');
        const staleRows = rows.filter((row) => row.name === 'Stale');
        expect(updatedRows).toHaveLength(1);
        expect(staleRows).toHaveLength(1);
        expect(rows).toContainEqual({ id: 3, name: 'Fresh' });
        expect(updatedRows[0]?.id).toBe(returned?.id);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateAll() returns all updated rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Draft', email: 'a@example.com' },
          { id: 2, name: 'Draft', email: 'b@example.com' },
          { id: 3, name: 'Published', email: 'c@example.com' },
        ]);

        const updated = await users.where({ name: 'Draft' }).updateAll({ name: 'Ready' });
        expect(updated).toHaveLength(2);
        expect(updated).toEqual(
          expect.arrayContaining([
            { id: 1, name: 'Ready', email: 'a@example.com', invitedById: null, address: null },
            { id: 2, name: 'Ready', email: 'b@example.com', invitedById: null, address: null },
          ]),
        );

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 1, name: 'Ready' },
          { id: 2, name: 'Ready' },
          { id: 3, name: 'Published' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateAll() with include() returns each updated row keyed to its own relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Draft', email: 'a@example.com' },
          { id: 2, name: 'Draft', email: 'b@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 2, views: 200 },
          { id: 12, title: 'Post C', userId: 2, views: 300 },
        ]);

        const updated = await users
          .where({ name: 'Draft' })
          .select('name')
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .updateAll({ name: 'Ready' });

        // The single read-back keyed by the returned identities buckets
        // each parent's relations back to the right row. Sort by the
        // first post id for a deterministic order, then assert the exact
        // shape: only the selected scalar and the included relations may
        // appear, so a read-back identity column leaking into the public
        // payload would fail here.
        const sorted = [...updated].sort((a, b) => a.posts[0]!.id - b.posts[0]!.id);
        expect(sorted).toEqual([
          {
            name: 'Ready',
            posts: [{ id: 10, title: 'Post A', userId: 1, views: 100, embedding: null }],
          },
          {
            name: 'Ready',
            posts: [
              { id: 11, title: 'Post B', userId: 2, views: 200, embedding: null },
              { id: 12, title: 'Post C', userId: 2, views: 300, embedding: null },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() with include() and select() keeps selected scalars and relation rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('name')
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .update({ name: 'Alice Updated' });

        expect(updated).toEqual({
          name: 'Alice Updated',
          posts: [
            { id: 10, title: 'Post A', userId: 1, views: 100, embedding: null },
            { id: 11, title: 'Post B', userId: 1, views: 200, embedding: null },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() and updateAll() reject when returning capability is disabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithoutReturning(runtime);
        const filtered = users.where({ id: 1 });

        await expect(filtered.update({ name: 'Blocked' })).rejects.toThrow(
          /requires contract capability "returning"/,
        );
        expect(() => filtered.updateAll({ name: 'Blocked' })).toThrow(
          /requires contract capability "returning"/,
        );
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() fires afterTransaction with committed once for its UPDATE, after its transaction commits',
    async () => {
      const events: Array<{ readonly hook: string; readonly sql: string; readonly scope: string }> =
        [];
      const observer: SqlMiddleware = {
        name: 'after-transaction-observer',
        familyId: 'sql',
        async afterQuery(exec, _result, ctx) {
          events.push({ hook: 'afterQuery', sql: exec.sql, scope: ctx.scope });
        },
        async afterTransaction(exec, result, ctx) {
          events.push({
            hook: `afterTransaction:${result.outcome}`,
            sql: exec.sql,
            scope: ctx.scope,
          });
        },
      };
      await withCollectionRuntime(
        async (runtime) => {
          const users = createReturningUsersCollection(runtime);
          await seedUsers(runtime, [{ id: 1, name: 'Stale', email: 'a@example.com' }]);
          events.length = 0;

          await users.where({ id: 1 }).update({ name: 'Updated' });

          const updateEvents = events.filter((event) =>
            event.sql.toLowerCase().startsWith('update'),
          );
          expect(updateEvents.map(({ hook, scope }) => ({ hook, scope }))).toEqual([
            { hook: 'afterQuery', scope: 'transaction' },
            { hook: 'afterTransaction:committed', scope: 'transaction' },
          ]);
          expect(events.map((event) => event.hook)).toEqual([
            'afterQuery',
            'afterQuery',
            'afterTransaction:committed',
            'afterTransaction:committed',
          ]);
        },
        undefined,
        [],
        [observer],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a statement that fails inside a transaction, caught by the callback, makes the commit report unknown',
    async () => {
      const stages: string[] = [];
      await withCollectionRuntime(
        async (runtime) => {
          await seedUsers(runtime, [{ id: 1, name: 'Stale', email: 'a@example.com' }]);

          await withTransaction(runtime, async (tx) => {
            const users = usersIn(tx);
            await users.where({ id: 1 }).updateAndCount({ name: 'Updated' });
            await expect(
              users.createAndCount([{ id: 1, name: 'Duplicate', email: 'b@example.com' }]),
            ).rejects.toThrow();
          });

          const rows = await runtime.query('select name from users where id = 1');
          expect({ stages, rows }).toEqual({
            stages: ['unknown', 'unknown'],
            rows: [{ name: 'Stale' }],
          });
        },
        undefined,
        [],
        [recordAfterTransaction(stages)],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a row stream stopped early inside a transaction does not stop the commit reporting committed',
    async () => {
      const stages: string[] = [];
      await withCollectionRuntime(
        async (runtime) => {
          await seedUsers(runtime, [
            { id: 1, name: 'Stale', email: 'a@example.com' },
            { id: 2, name: 'Stale', email: 'b@example.com' },
          ]);

          await withTransaction(runtime, async (tx) => {
            const users = usersIn(tx);
            for await (const _user of users.all()) {
              break;
            }
            await users.where({ id: 1 }).updateAndCount({ name: 'Updated' });
          });

          const rows = await runtime.query('select name from users where id = 1');
          expect({ stages, rows }).toEqual({
            stages: ['committed', 'committed'],
            rows: [{ name: 'Updated' }],
          });
        },
        undefined,
        [],
        [recordAfterTransaction(stages)],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateAll({}) and updateAndCount({}) are no-ops',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const updated = await users.where({ id: 1 }).updateAll({});
        const count = await users.where({ id: 1 }).updateAndCount({});

        expect(updated).toEqual([]);
        expect(count).toBe(0);
        expect(runtime.executions).toHaveLength(0);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

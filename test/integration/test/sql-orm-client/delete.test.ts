import type { SqlMiddleware } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

const returnsKey = Symbol('returns');

/** Records the SQL of every statement sent for its statistics. */
function statisticsStatementObserver(name: string, observed: string[]): SqlMiddleware {
  return {
    name,
    familyId: 'sql',
    async activityStarted(activity, ctx) {
      if (activity.kind === 'statement') ctx.state(returnsKey)['returns'] = activity.returns;
    },
    beforeEncode(exec, ctx) {
      if (ctx.state(returnsKey)['returns'] === 'stats') observed.push(exec.sql);
    },
  };
}

describe('integration/delete', () => {
  it(
    'deleteAndCount() returns matched row count and deletes data',
    async () => {
      const observedStatements: string[] = [];
      const observer = statisticsStatementObserver('delete-count-observer', observedStatements);
      await withCollectionRuntime(
        async (runtime) => {
          const users = createUsersCollection(runtime);

          await seedUsers(runtime, [
            { id: 1, name: 'Remove', email: 'a@example.com' },
            { id: 2, name: 'Remove', email: 'b@example.com' },
            { id: 3, name: 'Keep', email: 'c@example.com' },
          ]);
          observedStatements.length = 0;

          const count = await users.where({ name: 'Remove' }).deleteAndCount();
          expect(count).toBe(2);
          expect(observedStatements).toHaveLength(1);
          expect(observedStatements[0]?.toLowerCase()).toContain('delete');

          const rows = await runtime.query<{ id: number; name: string }>(
            'select id, name from users order by id',
          );
          expect(rows).toEqual([{ id: 3, name: 'Keep' }]);
        },
        undefined,
        [],
        [observer],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'delete() returns deleted row and null when no row matches',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Remove', email: 'a@example.com' },
          { id: 2, name: 'Keep', email: 'b@example.com' },
        ]);

        const deleted = await users.where({ id: 1 }).delete();
        expect(deleted).toEqual({
          id: 1,
          name: 'Remove',
          email: 'a@example.com',
          invitedById: null,
          address: null,
        });

        const missing = await users.where({ id: 999 }).delete();
        expect(missing).toBeNull();

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([{ id: 2, name: 'Keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'delete() affects only one row even when where() matches several',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Remove', email: 'a@example.com' },
          { id: 2, name: 'Remove', email: 'b@example.com' },
          { id: 3, name: 'Keep', email: 'c@example.com' },
        ]);

        const returned = await users.where({ name: 'Remove' }).delete();

        expect(returned).not.toBeNull();
        expect(returned?.name).toBe('Remove');
        expect([1, 2]).toContain(returned?.id);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        const remainingRemove = rows.filter((row) => row.name === 'Remove');
        expect(remainingRemove).toHaveLength(1);
        expect(remainingRemove[0]?.id).not.toBe(returned?.id);
        expect(rows).toContainEqual({ id: 3, name: 'Keep' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'deleteAll() returns all deleted rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Remove', email: 'a@example.com' },
          { id: 2, name: 'Remove', email: 'b@example.com' },
          { id: 3, name: 'Keep', email: 'c@example.com' },
        ]);

        const deleted = await users.where({ name: 'Remove' }).deleteAll();
        expect(deleted).toHaveLength(2);
        expect(deleted).toEqual(
          expect.arrayContaining([
            { id: 1, name: 'Remove', email: 'a@example.com', invitedById: null, address: null },
            { id: 2, name: 'Remove', email: 'b@example.com', invitedById: null, address: null },
          ]),
        );

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([{ id: 3, name: 'Keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'delete() with include() returns the deleted row with a pre-delete snapshot of its relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 1, views: 200 },
        ]);

        const deleted = await users
          .where({ id: 1 })
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .delete();

        // The relations are read together with the row before the DELETE
        // is issued, so the deleted row carries the posts it owned.
        expect(deleted).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
          posts: [
            { id: 10, title: 'Post A', userId: 1, views: 100, embedding: null },
            { id: 11, title: 'Post B', userId: 1, views: 200, embedding: null },
          ],
        });

        const userRows = await runtime.query<{ id: number }>('select id from users order by id');
        expect(userRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'deleteAll() with include() returns every deleted row with its relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Remove', email: 'a@example.com' },
          { id: 2, name: 'Remove', email: 'b@example.com' },
          { id: 3, name: 'Keep', email: 'c@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Post A', userId: 1, views: 100 },
          { id: 11, title: 'Post B', userId: 2, views: 200 },
        ]);

        const deleted = await users
          .where({ name: 'Remove' })
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .deleteAll();

        expect(deleted).toEqual(
          expect.arrayContaining([
            {
              id: 1,
              name: 'Remove',
              email: 'a@example.com',
              invitedById: null,
              address: null,
              posts: [{ id: 10, title: 'Post A', userId: 1, views: 100, embedding: null }],
            },
            {
              id: 2,
              name: 'Remove',
              email: 'b@example.com',
              invitedById: null,
              address: null,
              posts: [{ id: 11, title: 'Post B', userId: 2, views: 200, embedding: null }],
            },
          ]),
        );
        expect(deleted).toHaveLength(2);

        const remaining = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(remaining).toEqual([{ id: 3, name: 'Keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

import { describe, expect, it } from 'vitest';
import { createUsersCollection, timeouts, withCollectionRuntime } from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

function findEmittedSql(executions: readonly { sql: string }[]): string {
  const exec = executions[0];
  if (!exec) throw new Error('no executions captured');
  return exec.sql;
}

describe('integration/self-relations', () => {
  it(
    'include() resolves users -> invitedUsers (1:N) on the same model',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2 },
        ]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.orderBy((invitedUser) => invitedUser.id.asc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            invitedUsers: [
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1, address: null },
              { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1, address: null },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [
              { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 2, address: null },
            ],
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 1,
            address: null,
            invitedUsers: [],
          },
          {
            id: 4,
            name: 'Dan',
            email: 'dan@example.com',
            invitedById: 2,
            address: null,
            invitedUsers: [],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'orderBy on a depth-1 self-relation include applies against the aliased child table (regression: aliased orderBy remap)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        // Children of Alice are intentionally inserted in non-id order so
        // a missing alias-remap on the inner SELECT's orderBy would emit
        // them in insertion order (correlated against the outer User.id),
        // not in `invitedUser.id.desc()` order.
        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .where((u) => u.id.eq(1))
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.orderBy((invitedUser) => invitedUser.id.desc()),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            invitedUsers: [
              { id: 4, name: 'Dan', email: 'dan@example.com', invitedById: 1, address: null },
              { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1, address: null },
              { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1, address: null },
            ],
          },
        ]);

        // The hidden order projection inside the inner rows-subselect
        // must reference the aliased child table, not the original
        // `users` outer source, or Postgres correlates the ORDER BY
        // against the outer row and indeterminacy follows.
        const sql = findEmittedSql(runtime.executions);
        expect(sql).toContain('"users_2"."id" AS "invitedUsers__order_0"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() resolves users -> invitedBy (N:1) on the same model',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 2 },
        ]);

        const rows = await users
          .orderBy((user) => user.id.asc())
          .include('invitedBy')
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            invitedBy: null,
          },
          {
            id: 2,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: 1,
            address: null,
            invitedBy: {
              id: 1,
              name: 'Alice',
              email: 'alice@example.com',
              invitedById: null,
              address: null,
            },
          },
          {
            id: 3,
            name: 'Cara',
            email: 'cara@example.com',
            invitedById: 2,
            address: null,
            invitedBy: {
              id: 2,
              name: 'Bob',
              email: 'bob@example.com',
              invitedById: 1,
              address: null,
            },
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
  it(
    'include() on a self-relation applies the refinement filter to the included rows only',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
        ]);

        const rows = await users
          .select('id', 'name')
          .where((user) => user.name.eq('Alice'))
          .include('invitedUsers', (invitedUsers) =>
            invitedUsers.select('id', 'name').where((invitedUser) => invitedUser.name.eq('Bob')),
          )
          .all();

        expect(rows).toEqual([{ id: 1, name: 'Alice', invitedUsers: [{ id: 2, name: 'Bob' }] }]);
        const sql = findEmittedSql(runtime.executions);
        expect(sql).toContain('FROM "public"."users" AS "users_2"');
        expect(sql).toContain('"users_2"."name" = $');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include() that returns to an ancestor table reads the ancestor row through its own reference',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'First', userId: 1, views: 5 },
          { id: 11, title: 'Second', userId: 2, views: 50 },
        ]);

        const rows = await users
          .select('id')
          .orderBy((user) => user.id.asc())
          .include('posts', (posts) =>
            posts.select('id').include('author', (author) => author.select('name')),
          )
          .all();

        expect(rows).toEqual([
          { id: 1, posts: [{ id: 10, author: { name: 'Alice' } }] },
          { id: 2, posts: [{ id: 11, author: { name: 'Bob' } }] },
        ]);
        expect(findEmittedSql(runtime.executions)).toContain('FROM "public"."users" AS "users_2"');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a relation filter and an include of the same table return the same rows in either order',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 10, title: 'Quiet', userId: 1, views: 5 },
          { id: 11, title: 'Loud', userId: 1, views: 50 },
          { id: 12, title: 'Silent', userId: 2, views: 1 },
        ]);

        const filterThenInclude = await users
          .select('id')
          .where((user) => user.posts.some((post) => post.views.gt(10)))
          .include('posts', (posts) => posts.select('id').orderBy((post) => post.id.asc()))
          .all();
        const includeThenFilter = await users
          .select('id')
          .include('posts', (posts) => posts.select('id').orderBy((post) => post.id.asc()))
          .where((user) => user.posts.some((post) => post.views.gt(10)))
          .all();

        const expected = [{ id: 1, posts: [{ id: 10 }, { id: 11 }] }];
        expect(filterThenInclude).toEqual(expected);
        expect(includeThenFilter).toEqual(expected);
        expect(runtime.executions[0]?.sql).toContain('"posts_2"."user_id" = "users"."id"');
        expect(runtime.executions[1]?.sql).toContain('"posts_2"."views" > $');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'two sibling includes of the same table each return their own rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
        ]);

        const rows = await users
          .select('id')
          .orderBy((user) => user.id.asc())
          .include('invitedUsers', (invitedUsers) => invitedUsers.select('id'))
          .include('invitedBy', (invitedBy) => invitedBy.select('id'))
          .all();

        expect(rows).toEqual([
          { id: 1, invitedUsers: [{ id: 2 }], invitedBy: null },
          { id: 2, invitedUsers: [], invitedBy: { id: 1 } },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

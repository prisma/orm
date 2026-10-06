import { or } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import {
  createReturningPostsCollection,
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

describe('integration/nested-mutations', () => {
  it(
    'create() supports nested create() on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .create({
            id: 1,
            name: 'Nested User',
            email: 'nested@example.com',
            posts: (posts) =>
              posts.create([
                { id: 10, title: 'First nested post', views: 100 },
                { id: 11, title: 'Second nested post', views: 200 },
              ]),
          });

        expect(created).toEqual({
          id: 1,
          name: 'Nested User',
          email: 'nested@example.com',
          invitedById: null,
          address: null,
          posts: [
            { id: 10, title: 'First nested post', userId: 1, views: 100, embedding: null },
            { id: 11, title: 'Second nested post', userId: 1, views: 200, embedding: null },
          ],
        });

        const postRows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(postRows).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() supports nested connect() on to-one relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        await seedUsers(runtime, [{ id: 5, name: 'Author', email: 'author@example.com' }]);

        const created = await posts.create({
          id: 20,
          title: 'Connected Post',
          views: 7,
          author: (author) => author.connect({ id: 5 }),
        });

        expect(created).toEqual({
          id: 20,
          title: 'Connected Post',
          userId: 5,
          views: 7,
          embedding: null,
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts where id = $1',
          [20],
        );
        expect(rows).toEqual([{ id: 20, user_id: 5 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() supports deep nested create() across three levels',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);

        const updated = await users
          .where({ id: 1 })
          .include('posts', (posts) =>
            posts
              .orderBy((post) => post.id.asc())
              .include('comments', (comments) => comments.orderBy((comment) => comment.id.asc())),
          )
          .update({
            posts: (posts) =>
              posts.create([
                {
                  id: 30,
                  title: 'Deep Post',
                  views: 300,
                  comments: (comments) =>
                    comments.create([
                      {
                        id: 40,
                        body: 'Deep Comment',
                      },
                    ]),
                },
              ]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
          posts: [
            {
              id: 30,
              title: 'Deep Post',
              userId: 1,
              views: 300,
              embedding: null,
              comments: [{ id: 40, body: 'Deep Comment', postId: 30 }],
            },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() supports disconnect() with criteria on to-many relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Keep', userId: 1, views: 10 },
          { id: 11, title: 'Disconnect', userId: 1, views: 11 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .update({
            posts: (posts) => posts.disconnect([{ id: 11 }]),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
          posts: [{ id: 10, title: 'Keep', userId: 1, views: 10, embedding: null }],
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(rows).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() supports disconnect() on to-one relations',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Profile' }]);

        const updated = await users
          .where({ id: 1 })
          .include('profile')
          .update({
            profile: (profile) => profile.disconnect(),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          invitedById: null,
          address: null,
          profile: null,
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from profiles where id = $1',
          [100],
        );
        expect(rows).toEqual([{ id: 100, user_id: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() applies an array of operations on a to-many relation in array order',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Old first', userId: 1, views: 10 },
          { id: 11, title: 'Old second', userId: 1, views: 11 },
          { id: 12, title: 'Unowned', userId: null, views: 12 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'userId').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => [
              posts.disconnect(),
              posts.create({ id: 30, title: 'Created', views: 30 }),
              posts.connect({ id: 12 }),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 12, title: 'Unowned', userId: 1 },
            { id: 30, title: 'Created', userId: 1 },
          ],
        });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(rows).toEqual([
          { id: 10, user_id: null },
          { id: 11, user_id: null },
          { id: 12, user_id: 1 },
          { id: 30, user_id: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() lets a later disconnect() in the array undo an earlier create() and connect()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'Old first', userId: 1, views: 10 },
          { id: 12, title: 'Unowned', userId: null, views: 12 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'userId').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => [
              posts.create({ id: 30, title: 'Created', views: 30 }),
              posts.connect({ id: 12 }),
              posts.disconnect(),
            ],
          });

        expect(updated).toEqual({ id: 1, name: 'Alice', posts: [] });

        const rows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(rows).toEqual([
          { id: 10, user_id: null },
          { id: 12, user_id: null },
          { id: 30, user_id: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() lets the last operation in an array decide a to-one relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [{ id: 10, title: 'Post', userId: 1, views: 10 }]);

        const updated = await posts
          .where({ id: 10 })
          .select('id', 'title', 'userId')
          .update({
            author: (author) => [author.disconnect(), author.connect({ id: 2 })],
          });

        expect(updated).toEqual({ id: 10, title: 'Post', userId: 2 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() applies an array of operations on a to-many relation',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedPosts(runtime, [{ id: 12, title: 'Unowned', userId: null, views: 12 }]);

        const created = await users
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'userId').orderBy((post) => post.id.asc()),
          )
          .create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            posts: (posts) => [
              posts.create({ id: 30, title: 'Created', views: 30 }),
              posts.connect({ id: 12 }),
            ],
          });

        expect(created).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 12, title: 'Unowned', userId: 1 },
            { id: 30, title: 'Created', userId: 1 },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'an empty array leaves the relation unchanged in create() and update()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [{ id: 10, title: 'Kept', userId: 1, views: 10 }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title', 'userId'))
          .update({ name: 'Renamed', posts: () => [] });

        expect(updated).toEqual({
          id: 1,
          name: 'Renamed',
          posts: [{ id: 10, title: 'Kept', userId: 1 }],
        });

        const created = await users
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title', 'userId'))
          .create({ id: 2, name: 'Bob', email: 'bob@example.com', posts: () => [] });

        expect(created).toEqual({ id: 2, name: 'Bob', posts: [] });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() rejects a nested array and an element that is not an operation, writing nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedPosts(runtime, [{ id: 10, title: 'Kept', userId: 1, views: 10 }]);

        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            // @ts-expect-error
            posts: (posts) => [posts.disconnect(), [posts.connect({ id: 10 })]],
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_INVALID',
          meta: { relation: 'posts', model: 'User', problem: 'nested-array', index: 1 },
        });

        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            // @ts-expect-error
            posts: (posts) => [posts.disconnect(), { id: 10 }],
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_INVALID',
          meta: { relation: 'posts', model: 'User', problem: 'invalid-descriptor', index: 1 },
        });

        const userRows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(userRows).toEqual([{ id: 1, name: 'Alice' }]);
        const postRows = await runtime.query<{ id: number; user_id: number | null }>(
          'select id, user_id from posts order by id',
        );
        expect(postRows).toEqual([{ id: 10, user_id: 1 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() rejects disconnect() inside an array and rolls back the rows written before it',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            posts: (posts) => [
              posts.create({ id: 30, title: 'Created', views: 30 }),
              // @ts-expect-error
              posts.disconnect(),
            ],
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'disconnect', relation: 'posts' },
        });

        const userRows = await runtime.query<{ id: number }>('select id from users');
        expect(userRows).toEqual([]);
        const postRows = await runtime.query<{ id: number }>('select id from posts');
        expect(postRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  async function seedTwoUsersWithPosts(runtime: Parameters<typeof seedUsers>[0]) {
    await seedUsers(runtime, [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
    ]);
    await seedPosts(runtime, [
      { id: 10, title: 'Draft', userId: 1, views: 1 },
      { id: 11, title: 'Kept', userId: 1, views: 20 },
      { id: 20, title: 'Draft', userId: 2, views: 3 },
    ]);
  }

  function postRows(runtime: Parameters<typeof seedUsers>[0]) {
    return runtime.query<{ id: number; title: string; user_id: number | null; views: number }>(
      'select id, title, user_id, views from posts order by id',
    );
  }

  it(
    'update() where().updateAll() changes matching posts of the parent and leaves a matching post of another parent unchanged',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'views').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => posts.where({ title: 'Draft' }).updateAll({ views: 100 }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Draft', views: 100 },
            { id: 11, title: 'Kept', views: 20 },
          ],
        });
        expect(await postRows(runtime)).toEqual([
          { id: 10, title: 'Draft', user_id: 1, views: 100 },
          { id: 11, title: 'Kept', user_id: 1, views: 20 },
          { id: 20, title: 'Draft', user_id: 2, views: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() where().deleteAll() deletes matching posts of the parent and leaves a matching post of another parent unchanged',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'views').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => posts.where({ title: 'Draft' }).deleteAll(),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [{ id: 11, title: 'Kept', views: 20 }],
        });
        expect(await postRows(runtime)).toEqual([
          { id: 11, title: 'Kept', user_id: 1, views: 20 },
          { id: 20, title: 'Draft', user_id: 2, views: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() updateAll() and deleteAll() without where apply to every post of the parent only',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        const alice = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'views').orderBy((post) => post.id.asc()),
          )
          .update({ posts: (posts) => posts.updateAll({ views: 0 }) });

        expect(alice).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Draft', views: 0 },
            { id: 11, title: 'Kept', views: 0 },
          ],
        });

        const bob = await users
          .where({ id: 2 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title', 'views'))
          .update({ posts: (posts) => posts.deleteAll() });

        expect(bob).toEqual({ id: 2, name: 'Bob', posts: [] });
        expect(await postRows(runtime)).toEqual([
          { id: 10, title: 'Draft', user_id: 1, views: 0 },
          { id: 11, title: 'Kept', user_id: 1, views: 0 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() where() takes a callback over the related model and chained calls combine with AND',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);
        await seedPosts(runtime, [{ id: 12, title: 'Draft', userId: 1, views: 50 }]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'views').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => [
              posts
                .where((post) => post.views.gt(10))
                .where({ title: 'Draft' })
                .updateAll({ title: 'Popular draft' }),
              posts.where((post) => post.views.lt(5)).deleteAll(),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 11, title: 'Kept', views: 20 },
            { id: 12, title: 'Popular draft', views: 50 },
          ],
        });
        expect(await postRows(runtime)).toEqual([
          { id: 11, title: 'Kept', user_id: 1, views: 20 },
          { id: 12, title: 'Popular draft', user_id: 1, views: 50 },
          { id: 20, title: 'Draft', user_id: 2, views: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() updateAll() and deleteAll() change nothing when no post matches or the data is empty',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'views').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => [
              posts.where({ title: 'Missing' }).updateAll({ views: 100 }),
              posts.where({ title: 'Missing' }).deleteAll(),
              posts.updateAll({}),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Draft', views: 1 },
            { id: 11, title: 'Kept', views: 20 },
          ],
        });
        expect(await postRows(runtime)).toEqual([
          { id: 10, title: 'Draft', user_id: 1, views: 1 },
          { id: 11, title: 'Kept', user_id: 1, views: 20 },
          { id: 20, title: 'Draft', user_id: 2, views: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() runs updateAll() and deleteAll() in array order with create()',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'views').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => [
              posts.where({ title: 'Draft' }).updateAll({ views: 7 }),
              posts.create({ id: 30, title: 'Draft', views: 0 }),
              posts.where({ title: 'Kept' }).deleteAll(),
              posts.create({ id: 31, title: 'Kept', views: 0 }),
              posts.where({ title: 'Kept' }).updateAll({ views: 9 }),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Draft', views: 7 },
            { id: 30, title: 'Draft', views: 0 },
            { id: 31, title: 'Kept', views: 9 },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() rejects updateAll() data that sets the foreign key to the parent and rolls back',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            posts: (posts) => [
              posts.where({ title: 'Kept' }).deleteAll(),
              // @ts-expect-error
              posts.updateAll({ userId: 2 }),
            ],
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_INVALID',
          meta: {
            kind: 'updateAll',
            relation: 'posts',
            problem: 'parent-link-column',
            fields: ['userId'],
          },
        });

        const userRows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(userRows).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        expect(await postRows(runtime)).toEqual([
          { id: 10, title: 'Draft', user_id: 1, views: 1 },
          { id: 11, title: 'Kept', user_id: 1, views: 20 },
          { id: 20, title: 'Draft', user_id: 2, views: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() rejects updateAll() and deleteAll() and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            // @ts-expect-error
            posts: (posts) => posts.where({ title: 'Draft' }).updateAll({ views: 1 }),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'updateAll', relation: 'posts' },
        });

        await expect(
          users.create({
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            // @ts-expect-error
            posts: (posts) => posts.deleteAll(),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'deleteAll', relation: 'posts' },
        });

        const userRows = await runtime.query<{ id: number }>('select id from users');
        expect(userRows).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() rejects updateAll() and deleteAll() on to-one relations and rolls back',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        const posts = createReturningPostsCollection(runtime);
        await seedTwoUsersWithPosts(runtime);
        await seedProfiles(runtime, [{ id: 100, userId: 1, bio: 'Profile' }]);

        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            // @ts-expect-error
            profile: (profile) => profile.deleteAll(),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'deleteAll', relation: 'profile', reason: 'to-one-relation' },
        });

        await expect(
          posts.where({ id: 10 }).update({
            title: 'Renamed',
            // @ts-expect-error
            author: (author) => author.updateAll({ name: 'Renamed' }),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'updateAll', relation: 'author', reason: 'to-one-relation' },
        });

        const userRows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(userRows).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        const profileRows = await runtime.query<{ id: number }>('select id from profiles');
        expect(profileRows).toEqual([{ id: 100 }]);
        expect(await postRows(runtime)).toEqual([
          { id: 10, title: 'Draft', user_id: 1, views: 1 },
          { id: 11, title: 'Kept', user_id: 1, views: 20 },
          { id: 20, title: 'Draft', user_id: 2, views: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() where(or(...)).updateAll() leaves a post of another parent that matches a later branch unchanged',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'views').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) =>
              posts
                .where((post) => or(post.views.gt(15), post.title.eq('Draft')))
                .updateAll({ views: 100 }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Draft', views: 100 },
            { id: 11, title: 'Kept', views: 100 },
          ],
        });
        expect(await postRows(runtime)).toEqual([
          { id: 10, title: 'Draft', user_id: 1, views: 100 },
          { id: 11, title: 'Kept', user_id: 1, views: 100 },
          { id: 20, title: 'Draft', user_id: 2, views: 3 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() where(or(...)).deleteAll() leaves a post of another parent that matches a later branch unchanged',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTwoUsersWithPosts(runtime);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title', 'views'))
          .update({
            posts: (posts) =>
              posts.where((post) => or(post.views.gt(15), post.title.eq('Draft'))).deleteAll(),
          });

        expect(updated).toEqual({ id: 1, name: 'Alice', posts: [] });
        expect(await postRows(runtime)).toEqual([{ id: 20, title: 'Draft', user_id: 2, views: 3 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

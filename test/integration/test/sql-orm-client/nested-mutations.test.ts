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
    'create() creates the related row of a to-one relation the new row holds the key for, before it',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        const created = await posts.select('id', 'title', 'userId').create({
          id: 20,
          title: 'Hello',
          views: 1,
          author: (author) => author.create({ id: 5, name: 'Ada', email: 'ada@example.com' }),
        });

        expect(created).toEqual({ id: 20, title: 'Hello', userId: 5 });
        expect(await runtime.query('select id, name from users')).toEqual([{ id: 5, name: 'Ada' }]);
        expect(await runtime.query('select id, user_id from posts')).toEqual([
          { id: 20, user_id: 5 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() rejects a relation field that is not a callback and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedUsers(runtime, [{ id: 2, name: 'Grace', email: 'grace@example.com' }]);

        await expect(
          users.create({
            id: 1,
            name: 'Ada',
            email: 'ada@example.com',
            invitedBy: (inviter) => inviter.connect({ id: 2 }),
            posts: [] as never,
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.RELATION_MUTATION_INVALID',
            meta: { relation: 'posts', model: 'User', problem: 'missing-callback' },
          }),
        );
        expect(await runtime.query('select id from users order by id')).toEqual([{ id: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() connects a to-one relation the row holds the key for and sets its other values in one update',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);
        await seedUsers(runtime, [{ id: 5, name: 'Ada', email: 'ada@example.com' }]);
        await seedPosts(runtime, [{ id: 20, title: 'Old', userId: null, views: 1 }]);

        const updated = await posts
          .where({ id: 20 })
          .select('id', 'title', 'userId')
          .update({
            title: 'New',
            author: (author) => author.connect({ email: 'ada@example.com' }),
          });

        expect(updated).toEqual({ id: 20, title: 'New', userId: 5 });
        expect(await runtime.query('select id, title, user_id from posts')).toEqual([
          { id: 20, title: 'New', user_id: 5 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() creates the related row of a to-one relation the row holds the key for and points the row at it',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);
        await seedPosts(runtime, [{ id: 20, title: 'Old', userId: null, views: 1 }]);

        const updated = await posts
          .where({ id: 20 })
          .select('id', 'userId')
          .update({
            author: (author) => author.create({ id: 5, name: 'Ada', email: 'ada@example.com' }),
          });

        expect(updated).toEqual({ id: 20, userId: 5 });
        expect(await runtime.query('select id, name from users')).toEqual([{ id: 5, name: 'Ada' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() with nested operations resolves null and writes nothing when no row matches',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        const updated = await posts.where({ id: 20 }).update({
          title: 'New',
          author: (author) => author.create({ id: 5, name: 'Ada', email: 'ada@example.com' }),
        });

        expect(updated).toBeNull();
        expect(await runtime.query('select id from users')).toEqual([]);
        expect(await runtime.query('select id from posts')).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() rejects invalid nested input before any statement, even when no row matches',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        await expect(
          users.where({ id: 99 }).update({ posts: (posts) => posts.connect({} as never) }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.RELATION_MUTATION_INVALID',
            meta: { kind: 'connect', relation: 'posts', problem: 'empty-criterion' },
          }),
        );
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() rejects a relation field that is not a callback and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedUsers(runtime, [{ id: 1, name: 'Ada', email: 'ada@example.com' }]);

        await expect(
          users.where({ id: 1 }).update({ name: 'Grace', posts: [] as never }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.RELATION_MUTATION_INVALID',
            meta: { relation: 'posts', model: 'User', problem: 'missing-callback' },
          }),
        );
        expect(await runtime.query('select name from users')).toEqual([{ name: 'Ada' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

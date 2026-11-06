import { describe, expect, it } from 'vitest';
import {
  createReturningPostsCollection,
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

describe('integration/nested update() through the mutation graph', () => {
  it(
    'connects the row the parent holds the key for and sets the other values in one update',
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
    'creates the row the parent holds the key for and points the parent at it',
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
    'sets the key of the parent on the children a connect matches, with nothing else set',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedUsers(runtime, [{ id: 1, name: 'Ada', email: 'ada@example.com' }]);
        await seedPosts(runtime, [
          { id: 10, title: 'First', userId: null, views: 1 },
          { id: 11, title: 'Second', userId: null, views: 2 },
        ]);

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id'))
          .update({ posts: (posts) => posts.connect({ id: 11 }) });

        expect(updated).toEqual({ id: 1, name: 'Ada', posts: [{ id: 11 }] });
        expect(await runtime.query('select id, user_id from posts order by id')).toEqual([
          { id: 10, user_id: null },
          { id: 11, user_id: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'resolves null and writes nothing when no row matches',
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
    'rejects invalid nested input before any statement, even when no row matches',
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
    'rejects a relation field that is not a callback and writes nothing',
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

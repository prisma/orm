import type { Char } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import {
  createReturningPostsCollection,
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedTags, seedUsers } from './runtime-helpers';

const TAG_SQL = 'tag-sql' as Char<36>;

describe('integration/nested create() through the mutation graph', () => {
  it(
    'creates the related row of a relation the parent holds the key for, before the parent',
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
    'rejects a connect that finds no row and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        await expect(
          posts.create({
            id: 20,
            title: 'Hello',
            views: 1,
            author: (author) => author.connect({ id: 5 }),
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.RELATION_ROW_MISSING',
            message: 'connect() nested mutation for relation "author" did not find a matching row',
            meta: { kind: 'connect', relation: 'author' },
          }),
        );
        expect(await runtime.query('select id from posts')).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'sets the key of the new parent on the children a connect matches, and on nothing else',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedPosts(runtime, [
          { id: 10, title: 'First', userId: null, views: 1 },
          { id: 11, title: 'Second', userId: null, views: 2 },
          { id: 12, title: 'Third', userId: null, views: 3 },
        ]);

        const created = await users
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id').orderBy((post) => post.id.asc()))
          .create({
            id: 1,
            name: 'Ada',
            email: 'ada@example.com',
            posts: (posts) => posts.connect([{ id: 10 }, { id: 12 }, { id: 99 }]),
          });

        expect(created).toEqual({ id: 1, name: 'Ada', posts: [{ id: 10 }, { id: 12 }] });
        expect(await runtime.query('select id, user_id from posts order by id')).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: null },
          { id: 12, user_id: 1 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'creates nested children of nested children, each with the key of its parent',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users.select('id', 'name').create({
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          posts: (posts) =>
            posts.create([
              {
                id: 10,
                title: 'First',
                views: 1,
                comments: (comments) =>
                  comments.create([
                    { id: 100, body: 'One' },
                    { id: 101, body: 'Two' },
                  ]),
              },
              { id: 11, title: 'Second', views: 2 },
            ]),
        });

        expect(created).toEqual({ id: 1, name: 'Ada' });
        expect(await runtime.query('select id, user_id from posts order by id')).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: 1 },
        ]);
        expect(await runtime.query('select id, post_id from comments order by id')).toEqual([
          { id: 100, post_id: 10 },
          { id: 101, post_id: 10 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'links a tag once when two connect criteria find the same tag',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedTags(runtime, [{ id: TAG_SQL, name: 'SQL' }]);

        const created = await users
          .select('id')
          .include('tags', (tags) => tags.select('id', 'name'))
          .create({
            id: 1,
            name: 'Ada',
            email: 'ada@example.com',
            tags: (tags) => tags.connect([{ id: TAG_SQL }, { name: 'SQL' }]),
          });

        expect(created).toEqual({ id: 1, tags: [{ id: TAG_SQL, name: 'SQL' }] });
        expect(await runtime.query('select user_id, tag_id from user_tags')).toEqual([
          { user_id: 1, tag_id: TAG_SQL },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'rejects a relation field that is not a callback and writes nothing',
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
    'rejects disconnect in create() and writes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);

        await expect(
          posts.create({
            id: 20,
            title: 'Hello',
            views: 1,
            author: ((author: { disconnect: () => unknown }) => author.disconnect()) as never,
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
            meta: { kind: 'disconnect', relation: 'author' },
          }),
        );
        expect(await runtime.query('select id from posts')).toEqual([]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

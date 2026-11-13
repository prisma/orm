import { describe, expect, it } from 'vitest';
import {
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { type PgIntegrationRuntime, seedPosts, seedUsers } from './runtime-helpers';

async function seedOtherAuthor(runtime: PgIntegrationRuntime): Promise<void> {
  await seedUsers(runtime, [{ id: 9, name: 'Other', email: 'other@example.com' }]);
  await seedPosts(runtime, [{ id: 10, title: 'Taken', userId: 9, views: 3 }]);
}

async function tablesOf(runtime: PgIntegrationRuntime) {
  return {
    posts: await runtime.query('select id, title, user_id, views from posts order by id'),
    comments: await runtime.query('select id, post_id, body from comments order by id'),
  };
}

const takenPost = { id: 10, title: 'Taken', user_id: 9, views: 3 };

describe('integration/nested create with onConflict skip on a one-to-many relation', () => {
  it(
    'create() inserts and links the rows that do not collide, leaves a colliding row unchanged and unlinked, and runs callbacks only under inserted rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedOtherAuthor(runtime);

        const created = await users
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title').orderBy((post) => post.id.asc()))
          .create({
            id: 1,
            name: 'Ada',
            email: 'ada@example.com',
            posts: (posts) =>
              posts.create(
                [
                  {
                    id: 10,
                    title: 'Clash',
                    views: 0,
                    comments: (comments) => comments.create({ id: 100, body: 'Skipped' }),
                  },
                  {
                    id: 11,
                    title: 'New',
                    views: 1,
                    comments: (comments) => comments.create({ id: 101, body: 'Kept' }),
                  },
                ],
                { onConflict: 'skip' },
              ),
          });

        expect({ created, ...(await tablesOf(runtime)) }).toEqual({
          created: { id: 1, name: 'Ada', posts: [{ id: 11, title: 'New' }] },
          posts: [takenPost, { id: 11, title: 'New', user_id: 1, views: 1 }],
          comments: [{ id: 101, post_id: 11, body: 'Kept' }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() skips a row that collides on the conflictOn field with an unrelated row and inserts the others in one statement',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await runtime.query('create unique index posts_title_unique on posts (title)');
        await seedUsers(runtime, [{ id: 1, name: 'Ada', email: 'ada@example.com' }]);
        await seedOtherAuthor(runtime);

        runtime.resetExecutions();
        const updated = await users
          .select('id')
          .include('posts', (posts) => posts.select('id', 'title').orderBy((post) => post.id.asc()))
          .where({ id: 1 })
          .update({
            posts: (posts) =>
              posts.create(
                [
                  { id: 20, title: 'Taken', views: 0 },
                  { id: 21, title: 'Fresh', views: 2 },
                  { id: 22, title: 'Also fresh', views: 4 },
                ],
                { onConflict: 'skip', conflictOn: ['title'] },
              ),
          });

        expect({ updated, ...(await tablesOf(runtime)) }).toEqual({
          updated: {
            id: 1,
            posts: [
              { id: 21, title: 'Fresh' },
              { id: 22, title: 'Also fresh' },
            ],
          },
          posts: [
            takenPost,
            { id: 21, title: 'Fresh', user_id: 1, views: 2 },
            { id: 22, title: 'Also fresh', user_id: 1, views: 4 },
          ],
          comments: [],
        });
        expect(
          runtime.executions.filter(({ sql }) => sql.toLowerCase().startsWith('insert')),
        ).toHaveLength(1);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() refuses a row that gives no value for any conflict key before any statement',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedUsers(runtime, [{ id: 1, name: 'Ada', email: 'ada@example.com' }]);

        runtime.resetExecutions();
        await expect(
          users.where({ id: 1 }).update({
            posts: (posts) =>
              posts.create([{ id: 20, title: 'No embedding', views: 0 }], {
                onConflict: 'skip',
                conflictOn: ['embedding'],
              }),
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.RELATION_MUTATION_INVALID',
            meta: {
              kind: 'create',
              relation: 'posts',
              problem: 'row-cannot-conflict',
              index: 0,
              conflictKeys: [['embedding']],
            },
          }),
        );
        expect({ executions: runtime.executions, ...(await tablesOf(runtime)) }).toEqual({
          executions: [],
          posts: [],
          comments: [],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});

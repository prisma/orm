import { describe, expect, it } from 'vitest';
import {
  createReturningPostsCollection,
  createReturningUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { type PgIntegrationRuntime, seedPosts, seedProfiles, seedUsers } from './runtime-helpers';

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
});

describe('integration/nested create with onConflict connect on a child-held relation', () => {
  it(
    'create() links a colliding row of another parent by its conflictOn field with its other fields unchanged, and runs its callbacks under it',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await runtime.query('create unique index posts_title_unique on posts (title)');
        await seedOtherAuthor(runtime);

        const created = await users
          .select('id')
          .include('posts', (posts) => posts.select('id', 'title').orderBy((post) => post.id.asc()))
          .create({
            id: 1,
            name: 'Ada',
            email: 'ada@example.com',
            posts: (posts) =>
              posts.create(
                [
                  {
                    id: 20,
                    title: 'Taken',
                    views: 0,
                    comments: (comments) => comments.create({ id: 100, body: 'On the taken post' }),
                  },
                  { id: 21, title: 'New', views: 1 },
                ],
                { onConflict: 'connect', conflictOn: ['title'] },
              ),
          });

        expect({ created, ...(await tablesOf(runtime)) }).toEqual({
          created: {
            id: 1,
            posts: [
              { id: 10, title: 'Taken' },
              { id: 21, title: 'New' },
            ],
          },
          posts: [
            { ...takenPost, user_id: 1 },
            { id: 21, title: 'New', user_id: 1, views: 1 },
          ],
          comments: [{ id: 100, post_id: 10, body: 'On the taken post' }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() moves a colliding row of another parent by its key and links the profile the parent already has again without a change',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        await seedUsers(runtime, [{ id: 1, name: 'Ada', email: 'ada@example.com' }]);
        await seedOtherAuthor(runtime);
        await seedProfiles(runtime, [{ id: 5, userId: 1, bio: 'Original' }]);

        await users.where({ id: 1 }).update({
          posts: (posts) =>
            posts.create(
              [
                { id: 10, title: 'Changed', views: 0 },
                { id: 11, title: 'New', views: 1 },
              ],
              { onConflict: 'connect' },
            ),
          profile: (profile) =>
            profile.create({ id: 5, bio: 'Changed' }, { onConflict: 'connect' }),
        });

        expect({
          ...(await tablesOf(runtime)),
          profiles: await runtime.query('select id, user_id, bio from profiles'),
        }).toEqual({
          posts: [
            { ...takenPost, user_id: 1 },
            { id: 11, title: 'New', user_id: 1, views: 1 },
          ],
          comments: [],
          profiles: [{ id: 5, user_id: 1, bio: 'Original' }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});

describe('integration/nested create with onConflict connect on a parent-held or many-to-many relation', () => {
  async function linksOf(runtime: PgIntegrationRuntime) {
    return {
      users: await runtime.query('select id, name, email from users order by id'),
      tags: await runtime.query('select name from tags order by name'),
      userTags: await runtime.query(
        'select user_tags.user_id, tags.id, tags.name from user_tags join tags on tags.id = user_tags.tag_id order by tags.name',
      ),
    };
  }

  it(
    'create() links an unrelated row the conflictOn field matches, unchanged, and creates and links a new one',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);
        const users = createReturningUsersCollection(runtime);
        await runtime.query('create unique index users_email_unique on users (email)');
        await seedUsers(runtime, [{ id: 9, name: 'Other', email: 'other@example.com' }]);
        await runtime.query("insert into tags (id, name) values ('go', 'Go')");

        const post = await posts.select('id', 'userId').create({
          id: 30,
          title: 'Linked',
          views: 0,
          author: (author) =>
            author.create(
              { id: 50, name: 'Changed', email: 'other@example.com' },
              { onConflict: 'connect', conflictOn: ['email'] },
            ),
        });
        const user = await users.select('id').create({
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          tags: (tags) =>
            tags.create([{ name: 'Go' }, { name: 'Rust' }], {
              onConflict: 'connect',
              conflictOn: ['name'],
            }),
        });
        expect({ post, user, ...(await linksOf(runtime)) }).toEqual({
          post: { id: 30, userId: 9 },
          user: { id: 1 },
          users: [
            { id: 1, name: 'Ada', email: 'ada@example.com' },
            { id: 9, name: 'Other', email: 'other@example.com' },
          ],
          tags: [{ name: 'Go' }, { name: 'Rust' }],
          userTags: [
            { user_id: 1, id: 'go', name: 'Go' },
            { user_id: 1, id: expect.any(String), name: 'Rust' },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() creates and links a new parent-held row, and links an already linked target again without a second junction row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const posts = createReturningPostsCollection(runtime);
        const users = createReturningUsersCollection(runtime);
        await seedUsers(runtime, [{ id: 1, name: 'Ada', email: 'ada@example.com' }]);
        await seedPosts(runtime, [{ id: 30, title: 'Post', userId: 1, views: 0 }]);
        await runtime.query("insert into tags (id, name) values ('go', 'Go')");
        await runtime.query("insert into user_tags (user_id, tag_id) values (1, 'go')");

        await posts.where({ id: 30 }).update({
          author: (author) =>
            author.create(
              { id: 7, name: 'New', email: 'new@example.com' },
              { onConflict: 'connect' },
            ),
        });
        await users.where({ id: 1 }).update({
          tags: (tags) => tags.create({ id: 'go', name: 'Changed' }, { onConflict: 'connect' }),
        });

        expect({
          ...(await linksOf(runtime)),
          posts: await runtime.query('select id, user_id from posts'),
        }).toEqual({
          users: [
            { id: 1, name: 'Ada', email: 'ada@example.com' },
            { id: 7, name: 'New', email: 'new@example.com' },
          ],
          tags: [{ name: 'Go' }],
          userTags: [{ user_id: 1, id: 'go', name: 'Go' }],
          posts: [{ id: 30, user_id: 7 }],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerNumberColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection, or } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const UserTag = model('UserTag', {
  fields: {
    userId: field.column(integerNumberColumn).column('user_id'),
    tagId: field.column(integerNumberColumn).column('tag_id'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.tagId]),
  }))
  .sql({ table: 'user_tags' });
const Tag = model('Tag', {
  fields: { id: field.column(integerNumberColumn).id(), name: field.column(textColumn).unique() },
}).sql({ table: 'tags' });
const UserBase = model('User', {
  fields: { id: field.column(integerNumberColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'users' });
const Comment = model('Comment', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    postId: field.column(integerNumberColumn).column('post_id'),
    body: field.column(textColumn),
  },
}).sql({ table: 'comments' });
const Profile = model('Profile', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    userId: field.column(integerNumberColumn).column('user_id').unique(),
    bio: field.column(textColumn),
  },
}).sql({ table: 'profiles' });
const PostBase = model('Post', {
  fields: {
    id: field.column(integerNumberColumn).id(),
    userId: field.column(integerNumberColumn).column('user_id').optional(),
    title: field.column(textColumn),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }) },
}).sql({ table: 'posts' });
const contract = defineContract({
  models: {
    User: UserBase.relations({
      posts: rel.hasMany(() => PostBase, { by: 'userId' }),
      profile: rel.hasOne(() => Profile, { by: 'userId' }),
      tags: rel.manyToMany(() => Tag, { through: () => UserTag, from: 'userId', to: 'tagId' }),
    }).sql({ table: 'users' }),
    Post: PostBase.relations({
      comments: rel.hasMany(() => Comment, { by: 'postId' }),
    }).sql({ table: 'posts' }),
    Comment: Comment.relations({
      post: rel.belongsTo(PostBase, { from: 'postId', to: 'id' }).sql({ fk: {} }),
    }).sql({ table: 'comments' }),
    Profile,
    Tag,
    UserTag,
  },
});

type Collections = {
  readonly users: Collection<typeof contract, 'User'>;
  readonly posts: Collection<typeof contract, 'Post'>;
  readonly comments: Collection<typeof contract, 'Comment'>;
  readonly rows: (sql: string) => unknown[];
};

async function withDatabase(fn: (collections: Collections) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-nested-create-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(`
    create table users (id integer primary key, name text not null);
    create table posts (id integer primary key, user_id integer, title text not null);
    create table comments (id integer primary key, post_id integer not null, body text not null);
    create table profiles (id integer primary key, user_id integer not null unique, bio text not null);
    create table tags (id integer primary key, name text not null unique);
    create table user_tags (user_id integer not null, tag_id integer not null, primary key (user_id, tag_id));
    insert into tags values (1, 'SQL');
  `);
  database.close();

  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const instance = instantiateExecutionStack(stack);
  const { adapter, driver } = instance;
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver, closeRefusal: undefined });
  const namespaceId = soleDomainNamespaceId(contract.domain);
  const rows = (sql: string) => {
    const reader = new DatabaseSync(path);
    try {
      return reader
        .prepare(sql)
        .all()
        .map((row) => ({ ...row }));
    } finally {
      reader.close();
    }
  };
  try {
    await fn({
      users: new Collection({ runtime, context }, 'User', { namespaceId }),
      posts: new Collection({ runtime, context }, 'Post', { namespaceId }),
      comments: new Collection({ runtime, context }, 'Comment', { namespaceId }),
      rows,
    });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('integration/nested-mutations on SQLite: create()', () => {
  it(
    'creates children, created and connected tags, and returns the selected parent',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        const created = await users.select('id', 'name').create({
          id: 1,
          name: 'Ada',
          posts: (posts) =>
            posts.create([
              { id: 10, title: 'First' },
              { id: 11, title: 'Second' },
            ]),
          tags: (tags) => tags.create([{ id: 2, name: 'Rust' }]),
        });

        expect(created).toEqual({ id: 1, name: 'Ada' });
        expect(rows('select id, user_id from posts order by id')).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: 1 },
        ]);
        expect(rows('select id, name from tags order by id')).toEqual([
          { id: 1, name: 'SQL' },
          { id: 2, name: 'Rust' },
        ]);
        expect(rows('select user_id, tag_id from user_tags')).toEqual([{ user_id: 1, tag_id: 2 }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'creates the author of a post before the post and loads includes after every write',
    async () => {
      await withDatabase(async ({ posts, rows }) => {
        const created = await posts
          .select('id', 'title')
          .include('author', (author) => author.select('id', 'name'))
          .create({
            id: 10,
            title: 'Hello',
            author: (author) => author.create({ id: 5, name: 'Ada' }),
            comments: (comments) => comments.create([{ id: 100, body: 'Hi' }]),
          });

        expect(created).toEqual({ id: 10, title: 'Hello', author: { id: 5, name: 'Ada' } });
        expect(rows('select id, user_id from posts')).toEqual([{ id: 10, user_id: 5 }]);
        expect(rows('select id, post_id from comments')).toEqual([{ id: 100, post_id: 10 }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'skips a child that collides with an unrelated row under onConflict skip and runs callbacks only under inserted children',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        await users.create({
          id: 9,
          name: 'Other',
          posts: (posts) => posts.create({ id: 10, title: 'Taken' }),
        });

        const created = await users
          .select('id')
          .include('posts', (posts) => posts.select('id', 'title'))
          .create({
            id: 1,
            name: 'Ada',
            posts: (posts) =>
              posts.create(
                [
                  {
                    id: 10,
                    title: 'Clash',
                    comments: (comments) => comments.create({ id: 100, body: 'Skipped' }),
                  },
                  {
                    id: 11,
                    title: 'New',
                    comments: (comments) => comments.create({ id: 101, body: 'Kept' }),
                  },
                ],
                { onConflict: 'skip' },
              ),
          });

        expect({
          created,
          posts: rows('select id, user_id, title from posts order by id'),
          comments: rows('select id, post_id from comments order by id'),
        }).toEqual({
          created: { id: 1, posts: [{ id: 11, title: 'New' }] },
          posts: [
            { id: 10, user_id: 9, title: 'Taken' },
            { id: 11, user_id: 1, title: 'New' },
          ],
          comments: [{ id: 101, post_id: 11 }],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'links a child that collides on its key with a post of another user under onConflict connect, with its other fields unchanged, and runs its callbacks under it',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        await users.create({
          id: 9,
          name: 'Other',
          posts: (posts) => posts.create({ id: 10, title: 'Taken' }),
        });

        const created = await users
          .select('id')
          .include('posts', (posts) => posts.select('id', 'title'))
          .create({
            id: 1,
            name: 'Ada',
            posts: (posts) =>
              posts.create(
                {
                  id: 10,
                  title: 'Changed',
                  comments: (comments) => comments.create({ id: 100, body: 'On the taken post' }),
                },
                { onConflict: 'connect' },
              ),
          });

        expect({
          created,
          posts: rows('select id, user_id, title from posts order by id'),
          comments: rows('select id, post_id from comments order by id'),
        }).toEqual({
          created: { id: 1, posts: [{ id: 10, title: 'Taken' }] },
          posts: [{ id: 10, user_id: 1, title: 'Taken' }],
          comments: [{ id: 100, post_id: 10 }],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'links an existing author and an existing tag under onConflict connect, unchanged, and creates and links a new tag',
    async () => {
      await withDatabase(async ({ users, posts, rows }) => {
        await users.create({ id: 9, name: 'Other' });

        await posts.create({
          id: 30,
          title: 'Linked',
          author: (author) => author.create({ id: 9, name: 'Changed' }, { onConflict: 'connect' }),
        });
        await users.create({
          id: 1,
          name: 'Ada',
          tags: (tags) =>
            tags.create(
              [
                { id: 1, name: 'Changed' },
                { id: 2, name: 'New' },
              ],
              { onConflict: 'connect' },
            ),
        });

        expect({
          users: rows('select id, name from users order by id'),
          posts: rows('select id, user_id from posts'),
          tags: rows('select id, name from tags order by id'),
          userTags: rows('select user_id, tag_id from user_tags order by tag_id'),
        }).toEqual({
          users: [
            { id: 1, name: 'Ada' },
            { id: 9, name: 'Other' },
          ],
          posts: [{ id: 30, user_id: 9 }],
          tags: [
            { id: 1, name: 'SQL' },
            { id: 2, name: 'New' },
          ],
          userTags: [
            { user_id: 1, tag_id: 1 },
            { user_id: 1, tag_id: 2 },
          ],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'links a tag once when two connect criteria find the same tag',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        const created = await users
          .select('id')
          .include('tags', (tags) => tags.select('id', 'name'))
          .create({
            id: 1,
            name: 'Ada',
            tags: (tags) => tags.connect([{ id: 1 }, { name: 'SQL' }]),
          });

        expect(created).toEqual({ id: 1, tags: [{ id: 1, name: 'SQL' }] });
        expect(rows('select user_id, tag_id from user_tags')).toEqual([{ user_id: 1, tag_id: 1 }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'writes nothing when a connect finds no row',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        await expect(
          users.create({
            id: 1,
            name: 'Ada',
            posts: (posts) => posts.create([{ id: 10, title: 'First' }]),
            tags: (tags) => tags.connect({ name: 'Missing' }),
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.RELATION_ROW_MISSING',
            meta: { kind: 'connect', relation: 'tags' },
          }),
        );
        expect(rows('select id from users')).toEqual([]);
        expect(rows('select id from posts')).toEqual([]);
        expect(rows('select user_id from user_tags')).toEqual([]);
      });
    },
    timeouts.databaseOperation,
  );
});

describe('integration/nested-mutations on SQLite: update()', () => {
  it(
    'connects an author, links and unlinks tags, and disconnects a child',
    async () => {
      await withDatabase(async ({ users, posts, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          posts: (children) => children.create([{ id: 10, title: 'First' }]),
          tags: (tags) => tags.connect({ id: 1 }),
        });
        await users.create({
          id: 2,
          name: 'Grace',
          tags: (tags) => tags.create([{ id: 2, name: 'Rust' }]),
        });

        const post = await posts
          .where({ id: 10 })
          .select('id', 'userId')
          .update({ author: (author) => author.connect({ id: 2 }) });
        const user = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id').orderBy((tag) => tag['id']!.asc()))
          .update({
            name: 'Ada L.',
            tags: (tags) => tags.connect([{ id: 2 }, { id: 1 }]),
          });

        expect(post).toEqual({ id: 10, userId: 2 });
        expect(user).toEqual({ id: 1, name: 'Ada L.', tags: [{ id: 1 }, { id: 2 }] });

        const unlinked = await users
          .where({ id: 1 })
          .select('id')
          .update({ tags: (tags) => tags.disconnect([{ name: 'SQL' }]) });
        const orphaned = await users
          .where({ id: 2 })
          .select('id')
          .update({ posts: (children) => children.disconnect() });

        expect([unlinked, orphaned]).toEqual([{ id: 1 }, { id: 2 }]);
        expect(rows('select user_id, tag_id from user_tags order by user_id, tag_id')).toEqual([
          { user_id: 1, tag_id: 2 },
          { user_id: 2, tag_id: 2 },
        ]);
        expect(rows('select id, user_id from posts')).toEqual([{ id: 10, user_id: null }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'disconnect() with criteria on a relation the parent holds the key for unlinks only a matching linked row',
    async () => {
      await withDatabase(async ({ users, posts, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          posts: (children) => children.create([{ id: 10, title: 'Post' }]),
        });
        await users.create({ id: 2, name: 'Grace' });

        const unmatched = await posts
          .where({ id: 10 })
          .select('id', 'title', 'userId')
          .update({
            title: 'Edited',
            author: (author) => author.disconnect([{ id: 2 }]),
          });
        const matched = await posts
          .where({ id: 10 })
          .select('id', 'title', 'userId')
          .update({
            author: (author) => author.disconnect([{ id: 2 }, { id: 1 }]),
          });

        expect([unmatched, matched]).toEqual([
          { id: 10, title: 'Edited', userId: 1 },
          { id: 10, title: 'Edited', userId: null },
        ]);
        expect(rows('select id, user_id from posts')).toEqual([{ id: 10, user_id: null }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'refuses disconnect() on a relation whose foreign key is required, before any statement runs',
    async () => {
      await withDatabase(async ({ users, posts, comments, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          posts: (children) => children.create([{ id: 10, title: 'Post' }]),
        });
        await comments.create({ id: 100, postId: 10, body: 'Hi' });
        const refused = (relation: string) =>
          expect.objectContaining({
            code: 'ORM.OPERATION_UNSUPPORTED',
            meta: {
              kind: 'disconnect',
              relation,
              reason: 'required-foreign-key',
              model: 'Comment',
              fields: ['postId'],
            },
          });

        await expect(
          comments.where({ id: 100 }).update({
            body: 'Edited',
            // @ts-expect-error
            post: (post) => post.disconnect(),
          }),
        ).rejects.toThrow(refused('post'));
        await expect(
          posts.where({ id: 10 }).update({
            title: 'Edited',
            // @ts-expect-error
            comments: (children) => children.disconnect(),
          }),
        ).rejects.toThrow(refused('comments'));

        expect(rows('select id, post_id, body from comments')).toEqual([
          { id: 100, post_id: 10, body: 'Hi' },
        ]);
        expect(rows('select id, title from posts')).toEqual([{ id: 10, title: 'Post' }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'resolves null and writes nothing when no row matches',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        const updated = await users
          .where({ id: 9 })
          .update({ tags: (tags) => tags.create([{ id: 3, name: 'Go' }]) });

        expect(updated).toBeNull();
        expect(rows('select id from tags order by id')).toEqual([{ id: 1 }]);
        expect(rows('select user_id from user_tags')).toEqual([]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'skips a child that collides on conflictOn with a post of another user and links the others',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        await users.create({ id: 1, name: 'Ada' });
        await users.create({
          id: 9,
          name: 'Other',
          posts: (posts) => posts.create({ id: 10, title: 'Taken' }),
        });

        await users.where({ id: 1 }).update({
          posts: (posts) =>
            posts.create(
              [
                { id: 10, title: 'Clash' },
                { id: 11, title: 'New' },
              ],
              { onConflict: 'skip', conflictOn: ['id'] },
            ),
        });

        expect(rows('select id, user_id, title from posts order by id')).toEqual([
          { id: 10, user_id: 9, title: 'Taken' },
          { id: 11, user_id: 1, title: 'New' },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'moves a colliding post of another user under onConflict connect, inserts the others, and links the profile the user already has again without a change',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          profile: (profile) => profile.create({ id: 5, bio: 'Original' }),
        });
        await users.create({
          id: 9,
          name: 'Other',
          posts: (posts) => posts.create({ id: 10, title: 'Taken' }),
        });

        await users.where({ id: 1 }).update({
          posts: (posts) =>
            posts.create(
              [
                { id: 10, title: 'Changed' },
                { id: 11, title: 'New' },
              ],
              { onConflict: 'connect' },
            ),
          profile: (profile) =>
            profile.create({ id: 5, bio: 'Changed' }, { onConflict: 'connect' }),
        });

        expect({
          posts: rows('select id, user_id, title from posts order by id'),
          profiles: rows('select id, user_id, bio from profiles'),
        }).toEqual({
          posts: [
            { id: 10, user_id: 1, title: 'Taken' },
            { id: 11, user_id: 1, title: 'New' },
          ],
          profiles: [{ id: 5, user_id: 1, bio: 'Original' }],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'creates and links a new author under onConflict connect, and links an already linked tag again without a second junction row',
    async () => {
      await withDatabase(async ({ users, posts, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          posts: (mutator) => mutator.create({ id: 30, title: 'Post' }),
          tags: (tags) => tags.connect({ id: 1 }),
        });

        await posts.where({ id: 30 }).update({
          author: (author) => author.create({ id: 7, name: 'New' }, { onConflict: 'connect' }),
        });
        await users.where({ id: 1 }).update({
          tags: (tags) => tags.create({ id: 1, name: 'Changed' }, { onConflict: 'connect' }),
        });

        expect({
          users: rows('select id, name from users order by id'),
          posts: rows('select id, user_id from posts'),
          tags: rows('select id, name from tags order by id'),
          userTags: rows('select user_id, tag_id from user_tags'),
        }).toEqual({
          users: [
            { id: 1, name: 'Ada' },
            { id: 7, name: 'New' },
          ],
          posts: [{ id: 30, user_id: 7 }],
          tags: [{ id: 1, name: 'SQL' }],
          userTags: [{ user_id: 1, tag_id: 1 }],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'applies an array of operations on a to-many relation in array order',
    async () => {
      await withDatabase(async ({ users, posts }) => {
        await users.create({
          id: 1,
          name: 'Alice',
          posts: (children) => children.create([{ id: 10, title: 'Old' }]),
        });
        await posts.create({ id: 12, title: 'Unowned' });

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (children) =>
            children.select('id', 'title', 'userId').orderBy((post) => post['id']!.asc()),
          )
          .update({
            posts: (children) => [
              children.disconnect(),
              children.create({ id: 30, title: 'Created' }),
              children.connect({ id: 12 }),
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
      });
    },
    timeouts.databaseOperation,
  );

  async function seedTwoParents({ users }: Collections): Promise<void> {
    await users.create({
      id: 1,
      name: 'Alice',
      posts: (posts) =>
        posts.create([
          { id: 10, title: 'Draft' },
          { id: 11, title: 'Kept' },
        ]),
    });
    await users.create({
      id: 2,
      name: 'Bob',
      posts: (posts) => posts.create([{ id: 20, title: 'Draft' }]),
    });
  }

  const postRowsSql = 'select id, title, user_id from posts order by id';

  it(
    'where(or(...)).updateAll() leaves a post of another parent that matches a later branch unchanged',
    async () => {
      await withDatabase(async (collections) => {
        await seedTwoParents(collections);
        const { users, rows } = collections;

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title').orderBy((post) => post['id']!.asc()),
          )
          .update({
            posts: (posts) =>
              posts
                .where((post) => or(post['title']!.eq('Kept'), post['title']!.eq('Draft')))
                .updateAll({ title: 'Changed' }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Changed' },
            { id: 11, title: 'Changed' },
          ],
        });
        expect(rows(postRowsSql)).toEqual([
          { id: 10, title: 'Changed', user_id: 1 },
          { id: 11, title: 'Changed', user_id: 1 },
          { id: 20, title: 'Draft', user_id: 2 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'where(or(...)).deleteAll() leaves a post of another parent that matches a later branch unchanged',
    async () => {
      await withDatabase(async (collections) => {
        await seedTwoParents(collections);
        const { users, rows } = collections;

        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title'))
          .update({
            posts: (posts) =>
              posts
                .where((post) => or(post['title']!.eq('Kept'), post['title']!.eq('Draft')))
                .deleteAll(),
          });

        expect(updated).toEqual({ id: 1, name: 'Alice', posts: [] });
        expect(rows(postRowsSql)).toEqual([{ id: 20, title: 'Draft', user_id: 2 }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'where().update() and where().delete() change the first matching post of the parent only',
    async () => {
      await withDatabase(async (collections) => {
        await seedTwoParents(collections);
        const { users, rows } = collections;
        const update = (data: Parameters<typeof users.update>[0]) =>
          users.where({ id: 1 }).select('id', 'name').update(data);

        const updated = await update({
          posts: (posts) => posts.where({ title: 'Draft' }).update({ title: 'Published' }),
        });
        const afterUpdate = rows(postRowsSql);
        const unmatched = await update({
          posts: (posts) => [
            posts.where({ title: 'Missing' }).update({ title: 'Seen' }),
            posts.where({ title: 'Missing' }).delete(),
          ],
        });
        const afterUnmatched = rows(postRowsSql);
        const deleted = await update({
          posts: (posts) => posts.where({ title: 'Kept' }).delete(),
        });

        expect([updated, unmatched, deleted]).toEqual([
          { id: 1, name: 'Alice' },
          { id: 1, name: 'Alice' },
          { id: 1, name: 'Alice' },
        ]);
        expect(afterUpdate).toEqual([
          { id: 10, title: 'Published', user_id: 1 },
          { id: 11, title: 'Kept', user_id: 1 },
          { id: 20, title: 'Draft', user_id: 2 },
        ]);
        expect(afterUnmatched).toEqual(afterUpdate);
        expect(rows(postRowsSql)).toEqual([
          { id: 10, title: 'Published', user_id: 1 },
          { id: 20, title: 'Draft', user_id: 2 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() and delete() on a to-one relation change the linked row only when it matches',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        await users.create({
          id: 1,
          name: 'Alice',
          profile: (profile) => profile.create({ id: 100, bio: 'Old' }),
        });
        await users.create({
          id: 2,
          name: 'Bob',
          profile: (profile) => profile.create({ id: 200, bio: 'Old' }),
        });
        const profiles = 'select id, user_id, bio from profiles order by id';

        await users
          .where({ id: 1 })
          .update({ profile: (profile) => profile.update({ bio: 'New' }) });
        const afterUpdate = rows(profiles);
        await users
          .where({ id: 1 })
          .update({ profile: (profile) => profile.where({ bio: 'Old' }).delete() });
        const afterUnmatched = rows(profiles);
        await users
          .where({ id: 1 })
          .update({ profile: (profile) => profile.where({ bio: 'New' }).delete() });

        expect(afterUpdate).toEqual([
          { id: 100, user_id: 1, bio: 'New' },
          { id: 200, user_id: 2, bio: 'Old' },
        ]);
        expect(afterUnmatched).toEqual(afterUpdate);
        expect(rows(profiles)).toEqual([{ id: 200, user_id: 2, bio: 'Old' }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'where().update() and where().delete() on a many-to-many relation change the first matching related row only',
    async () => {
      await withDatabase(async ({ users, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          tags: (tags) => [tags.connect({ id: 1 }), tags.create([{ id: 2, name: 'Go' }])],
        });
        await users.create({
          id: 2,
          name: 'Grace',
          tags: (tags) => tags.create([{ id: 3, name: 'Swift' }]),
        });
        const tagRows = 'select id, name from tags order by id';

        await users.where({ id: 1 }).update({
          tags: (tags) => tags.where((tag) => tag['name']!.like('S%')).update({ name: 'Postgres' }),
        });
        const afterUpdate = rows(tagRows);
        await users.where({ id: 1 }).update({
          tags: (tags) => [
            tags.where((tag) => tag['name']!.like('X%')).update({ name: 'None' }),
            tags.where((tag) => tag['name']!.like('X%')).delete(),
          ],
        });
        const afterUnmatched = rows(tagRows);
        await users.where({ id: 1 }).update({
          tags: (tags) => tags.where({ name: 'Go' }).delete(),
        });

        expect(afterUpdate).toEqual([
          { id: 1, name: 'Postgres' },
          { id: 2, name: 'Go' },
          { id: 3, name: 'Swift' },
        ]);
        expect(afterUnmatched).toEqual(afterUpdate);
        expect(rows(tagRows)).toEqual([
          { id: 1, name: 'Postgres' },
          { id: 3, name: 'Swift' },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() and delete() on a relation the parent holds the key for change the linked row only when it matches',
    async () => {
      await withDatabase(async ({ users, posts, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          posts: (children) => children.create([{ id: 10, title: 'Linked' }]),
        });
        await users.create({ id: 2, name: 'Grace' });
        await posts.create({ id: 11, title: 'Unlinked' });
        const linked = posts.where({ id: 10 }).select('id', 'userId');

        await linked.update({
          title: 'Linked again',
          author: (author) => author.update({ name: 'Ada L.' }),
        });
        const afterUpdate = rows('select id, name from users order by id');
        const unmatched = await linked.update({
          author: (author) => author.where({ name: 'Nobody' }).delete(),
        });
        const notLinked = await posts
          .where({ id: 11 })
          .select('id', 'userId')
          .update({ author: (author) => author.delete() });
        const deleted = await linked.update({ author: (author) => author.delete() });

        expect(afterUpdate).toEqual([
          { id: 1, name: 'Ada L.' },
          { id: 2, name: 'Grace' },
        ]);
        expect([unmatched, notLinked, deleted]).toEqual([
          { id: 10, userId: 1 },
          { id: 11, userId: null },
          { id: 10, userId: null },
        ]);
        expect(rows('select id, name from users order by id')).toEqual([{ id: 2, name: 'Grace' }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'refuses delete() on a relation the parent holds a required key for, with the rows unchanged',
    async () => {
      await withDatabase(async ({ users, comments, rows }) => {
        await users.create({
          id: 1,
          name: 'Ada',
          posts: (children) => children.create([{ id: 10, title: 'Post' }]),
        });
        await comments.create({ id: 100, postId: 10, body: 'Hi' });

        await expect(
          comments.where({ id: 100 }).update({
            body: 'Edited',
            // @ts-expect-error
            post: (post) => post.delete(),
          }),
        ).rejects.toThrow(
          expect.objectContaining({
            code: 'ORM.OPERATION_UNSUPPORTED',
            meta: {
              kind: 'delete',
              relation: 'post',
              reason: 'required-foreign-key',
              model: 'Comment',
              fields: ['postId'],
            },
          }),
        );
        expect(rows('select id, post_id, body from comments')).toEqual([
          { id: 100, post_id: 10, body: 'Hi' },
        ]);
        expect(rows('select id from posts')).toEqual([{ id: 10 }]);
      });
    },
    timeouts.databaseOperation,
  );
});

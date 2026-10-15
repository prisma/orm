import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection } from '@internal/sql-orm-client';
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
    userId: field.column(integerColumn).column('user_id'),
    tagId: field.column(integerColumn).column('tag_id'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.tagId]),
  }))
  .sql({ table: 'user_tags' });
const Tag = model('Tag', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'tags' });
const UserBase = model('User', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'users' });
const Comment = model('Comment', {
  fields: {
    id: field.column(integerColumn).id(),
    postId: field.column(integerColumn).column('post_id'),
    body: field.column(textColumn),
  },
}).sql({ table: 'comments' });
const PostBase = model('Post', {
  fields: {
    id: field.column(integerColumn).id(),
    userId: field.column(integerColumn).column('user_id').optional(),
    title: field.column(textColumn),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }) },
}).sql({ table: 'posts' });
const contract = defineContract({
  models: {
    User: UserBase.relations({
      posts: rel.hasMany(() => PostBase, { by: 'userId' }),
      tags: rel.manyToMany(() => Tag, { through: () => UserTag, from: 'userId', to: 'tagId' }),
    }).sql({ table: 'users' }),
    Post: PostBase.relations({
      comments: rel.hasMany(() => Comment, { by: 'postId' }),
    }).sql({ table: 'posts' }),
    Comment: Comment.relations({
      post: rel.belongsTo(PostBase, { from: 'postId', to: 'id' }).sql({ fk: {} }),
    }).sql({ table: 'comments' }),
    Tag,
    UserTag,
  },
});

type Collections = {
  readonly users: Collection<typeof contract, 'User'>;
  readonly posts: Collection<typeof contract, 'Post'>;
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
      rows,
    });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('integration/nested create() through the mutation graph on SQLite', () => {
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

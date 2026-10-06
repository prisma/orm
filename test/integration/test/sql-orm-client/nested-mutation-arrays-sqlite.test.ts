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

const UserBase = model('User', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'users' });

const Post = model('Post', {
  fields: {
    id: field.column(integerColumn).id(),
    title: field.column(textColumn),
    userId: field.column(integerColumn).column('user_id').optional(),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }) },
}).sql({ table: 'posts' });

const Tag = model('Tag', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'tags' });

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

const User = UserBase.relations({
  posts: rel.hasMany(() => Post, { by: 'userId' }),
  tags: rel.manyToMany(() => Tag, { through: () => UserTag, from: 'userId', to: 'tagId' }),
}).sql({ table: 'users' });

const contract = defineContract({ models: { User, Post, Tag, UserTag } });

const schemaSql = `
  create table users (id integer primary key, name text not null);
  create table posts (
    id integer primary key,
    title text not null,
    user_id integer references users (id)
  );
  create table tags (id integer primary key, name text not null);
  create table user_tags (
    user_id integer not null references users (id),
    tag_id integer not null references tags (id),
    primary key (user_id, tag_id)
  );
`;

interface Harness {
  readonly users: Collection<typeof contract, 'User'>;
  readonly posts: Collection<typeof contract, 'Post'>;
  rows(sql: string): unknown[];
}

async function withSqlite(seedSql: string, fn: (harness: Harness) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-nested-mutation-arrays-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(schemaSql);
  database.exec(seedSql);

  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const { adapter, driver } = instantiateExecutionStack(stack);
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver, closeRefusal: undefined });
  const namespaceId = soleDomainNamespaceId(contract.domain);
  try {
    await fn({
      users: new Collection({ runtime, context }, 'User', { namespaceId }),
      posts: new Collection({ runtime, context }, 'Post', { namespaceId }),
      rows: (sql) => database.prepare(sql).all(),
    });
  } finally {
    await runtime.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const seedSql = `
  insert into users values (1, 'Alice'), (2, 'Bob');
  insert into posts values (10, 'Old first', 1), (11, 'Old second', 1), (12, 'Unowned', null);
  insert into tags values (1, 'Rust'), (2, 'TypeScript');
  insert into user_tags values (1, 1);
`;

describe('integration/nested mutation arrays on SQLite', () => {
  it(
    'update() applies an array of operations on a to-many relation in array order',
    async () => {
      await withSqlite(seedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'userId').orderBy((post) => post.id.asc()),
          )
          .update({
            posts: (posts) => [
              posts.disconnect(),
              posts.create({ id: 30, title: 'Created' }),
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
        expect(rows('select id, user_id from posts order by id')).toEqual([
          { id: 10, user_id: null },
          { id: 11, user_id: null },
          { id: 12, user_id: 1 },
          { id: 30, user_id: 1 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() lets a later disconnect() in the array undo an earlier create() and connect()',
    async () => {
      await withSqlite(seedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title', 'userId'))
          .update({
            posts: (posts) => [
              posts.create({ id: 30, title: 'Created' }),
              posts.connect({ id: 12 }),
              posts.disconnect(),
            ],
          });

        expect(updated).toEqual({ id: 1, name: 'Alice', posts: [] });
        expect(rows('select id, user_id from posts order by id')).toEqual([
          { id: 10, user_id: null },
          { id: 11, user_id: null },
          { id: 12, user_id: null },
          { id: 30, user_id: null },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() lets the last operation in an array decide a to-one relation',
    async () => {
      await withSqlite(seedSql, async ({ posts }) => {
        const updated = await posts
          .where({ id: 10 })
          .select('id', 'title', 'userId')
          .update({
            author: (author) => [author.disconnect(), author.connect({ id: 2 })],
          });

        expect(updated).toEqual({ id: 10, title: 'Old first', userId: 2 });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() applies an array on a junction relation in array order',
    async () => {
      await withSqlite(seedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag.id.asc()))
          .update({
            tags: (tags) => [
              tags.disconnect([{ id: 1 }]),
              tags.connect({ id: 2 }),
              tags.create({ id: 3, name: 'Go' }),
              tags.connect({ id: 1 }),
              tags.disconnect([{ id: 2 }]),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [
            { id: 1, name: 'Rust' },
            { id: 3, name: 'Go' },
          ],
        });
        expect(rows('select user_id, tag_id from user_tags order by tag_id')).toEqual([
          { user_id: 1, tag_id: 1 },
          { user_id: 1, tag_id: 3 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'create() applies arrays of operations on to-many and junction relations',
    async () => {
      await withSqlite(seedSql, async ({ users }) => {
        const created = await users
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'userId').orderBy((post) => post.id.asc()),
          )
          .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag.id.asc()))
          .create({
            id: 3,
            name: 'Carol',
            posts: (posts) => [
              posts.create({ id: 30, title: 'Created' }),
              posts.connect({ id: 12 }),
            ],
            tags: (tags) => [tags.connect({ id: 1 }), tags.create({ id: 3, name: 'Go' })],
          });

        expect(created).toEqual({
          id: 3,
          name: 'Carol',
          posts: [
            { id: 12, title: 'Unowned', userId: 3 },
            { id: 30, title: 'Created', userId: 3 },
          ],
          tags: [
            { id: 1, name: 'Rust' },
            { id: 3, name: 'Go' },
          ],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'an empty array leaves the relation unchanged in create() and update()',
    async () => {
      await withSqlite(seedSql, async ({ users }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id').orderBy((post) => post.id.asc()))
          .update({ name: 'Renamed', posts: () => [] });

        expect(updated).toEqual({ id: 1, name: 'Renamed', posts: [{ id: 10 }, { id: 11 }] });

        const created = await users
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id'))
          .create({ id: 3, name: 'Carol', posts: () => [] });

        expect(created).toEqual({ id: 3, name: 'Carol', posts: [] });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() rejects a nested array and an element that is not an operation, writing nothing',
    async () => {
      await withSqlite(seedSql, async ({ users, rows }) => {
        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            // @ts-expect-error
            posts: (posts) => [posts.disconnect(), [posts.connect({ id: 12 })]],
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_INVALID',
          meta: { relation: 'posts', model: 'User', problem: 'nested-array', index: 1 },
        });

        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            // @ts-expect-error
            posts: (posts) => [posts.disconnect(), { id: 12 }],
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_INVALID',
          meta: { relation: 'posts', model: 'User', problem: 'invalid-descriptor', index: 1 },
        });

        expect(rows('select id, name from users order by id')).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        expect(rows('select id, user_id from posts order by id')).toEqual([
          { id: 10, user_id: 1 },
          { id: 11, user_id: 1 },
          { id: 12, user_id: null },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'create() rejects disconnect() inside an array and rolls back the rows written before it',
    async () => {
      await withSqlite(seedSql, async ({ users, rows }) => {
        await expect(
          users.create({
            id: 3,
            name: 'Carol',
            posts: (posts) => [
              posts.create({ id: 30, title: 'Created' }),
              // @ts-expect-error
              posts.disconnect(),
            ],
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'disconnect', relation: 'posts' },
        });

        expect(rows('select id from users order by id')).toEqual([{ id: 1 }, { id: 2 }]);
        expect(rows('select id from posts order by id')).toEqual([
          { id: 10 },
          { id: 11 },
          { id: 12 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );
});

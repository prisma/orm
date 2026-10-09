import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
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

const UserBase = model('User', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'users' });

const Post = model('Post', {
  fields: {
    id: field.column(integerColumn).id(),
    title: field.column(textColumn),
    userId: field.column(integerColumn).column('user_id').optional(),
  },
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
  rows(sql: string): unknown[];
}

const cascadingSchemaSql = schemaSql.replace(
  'references tags (id)',
  'references tags (id) on delete cascade',
);

async function withSqlite(
  seedSql: string,
  fn: (harness: Harness) => Promise<void>,
  tablesSql = schemaSql,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-nested-mutation-arrays-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(tablesSql);
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
`;

describe('integration/nested mutations on SQLite', () => {
  it(
    'update() applies an array of operations on a to-many relation in array order',
    async () => {
      await withSqlite(seedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title', 'userId').orderBy((post) => post['id']!.asc()),
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

  const twoParentsSeedSql = `
    insert into users values (1, 'Alice'), (2, 'Bob');
    insert into posts values (10, 'Draft', 1), (11, 'Kept', 1), (20, 'Draft', 2);
  `;
  const postRowsSql = 'select id, title, user_id from posts order by id';

  it(
    'update() where(or(...)).updateAll() leaves a post of another parent that matches a later branch unchanged',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users, rows }) => {
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
    'update() where(or(...)).deleteAll() leaves a post of another parent that matches a later branch unchanged',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users, rows }) => {
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

  const twoUsersWithTagsSeedSql = `
    insert into users values (1, 'Alice'), (2, 'Bob');
    insert into tags values (1, 'Rust'), (2, 'TypeScript'), (3, 'Go');
    insert into user_tags values (1, 1), (1, 2), (2, 3);
  `;
  const tagRowsSql = 'select id, name from tags order by id';
  const userTagRowsSql = 'select user_id, tag_id from user_tags order by user_id, tag_id';
  const seededTagRows = [
    { id: 1, name: 'Rust' },
    { id: 2, name: 'TypeScript' },
    { id: 3, name: 'Go' },
  ];
  const seededUserTagRows = [
    { user_id: 1, tag_id: 1 },
    { user_id: 1, tag_id: 2 },
    { user_id: 2, tag_id: 3 },
  ];

  it(
    'update() where().updateAll() on a junction relation changes a matching linked tag and leaves a matching tag linked only to another user unchanged',
    async () => {
      await withSqlite(twoUsersWithTagsSeedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag['id']!.asc()))
          .update({
            tags: (tags) =>
              tags
                .where((tag) => or(tag['name']!.eq('Rust'), tag['name']!.eq('Go')))
                .updateAll({ name: 'Changed' }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [
            { id: 1, name: 'Changed' },
            { id: 2, name: 'TypeScript' },
          ],
        });
        expect(rows(tagRowsSql)).toEqual([
          { id: 1, name: 'Changed' },
          { id: 2, name: 'TypeScript' },
          { id: 3, name: 'Go' },
        ]);
        expect(rows(userTagRowsSql)).toEqual(seededUserTagRows);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() where().deleteAll() with cascading junction keys deletes a matching linked tag and its junction rows, leaving a matching tag linked only to another user',
    async () => {
      await withSqlite(
        twoUsersWithTagsSeedSql,
        async ({ users, rows }) => {
          const updated = await users
            .where({ id: 1 })
            .select('id', 'name')
            .include('tags', (tags) => tags.select('id', 'name'))
            .update({
              tags: (tags) =>
                tags.where((tag) => or(tag['name']!.eq('Rust'), tag['name']!.eq('Go'))).deleteAll(),
            });

          expect(updated).toEqual({
            id: 1,
            name: 'Alice',
            tags: [{ id: 2, name: 'TypeScript' }],
          });
          expect(rows(tagRowsSql)).toEqual([
            { id: 2, name: 'TypeScript' },
            { id: 3, name: 'Go' },
          ]);
          expect(rows(userTagRowsSql)).toEqual([
            { user_id: 1, tag_id: 2 },
            { user_id: 2, tag_id: 3 },
          ]);
        },
        cascadingSchemaSql,
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'update() deleteAll() with junction keys that do not cascade surfaces the database error and rolls back the whole update',
    async () => {
      await withSqlite(twoUsersWithTagsSeedSql, async ({ users, rows }) => {
        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            tags: (tags) => [
              tags.where({ name: 'TypeScript' }).updateAll({ name: 'Changed' }),
              tags.where({ name: 'Rust' }).deleteAll(),
            ],
          }),
        ).rejects.toThrow(/FOREIGN KEY constraint failed/);

        expect(rows('select id, name from users order by id')).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        expect(rows(tagRowsSql)).toEqual(seededTagRows);
        expect(rows(userTagRowsSql)).toEqual(seededUserTagRows);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() connect() to a tag that an earlier deleteAll() in the same array deleted rejects with ORM.RELATION_ROW_MISSING and rolls back the whole update',
    async () => {
      await withSqlite(
        twoUsersWithTagsSeedSql,
        async ({ users, rows }) => {
          await expect(
            users.where({ id: 1 }).update({
              name: 'Renamed',
              tags: (tags) => [tags.where({ id: 1 }).deleteAll(), tags.connect({ id: 1 })],
            }),
          ).rejects.toMatchObject({
            code: 'ORM.RELATION_ROW_MISSING',
            meta: { kind: 'connect', relation: 'tags' },
          });

          expect(rows('select id, name from users order by id')).toEqual([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ]);
          expect(rows(tagRowsSql)).toEqual(seededTagRows);
          expect(rows(userTagRowsSql)).toEqual(seededUserTagRows);
        },
        cascadingSchemaSql,
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'update() connect() naming the same tag twice links it once',
    async () => {
      await withSqlite(twoUsersWithTagsSeedSql, async ({ users, rows }) => {
        await users.where({ id: 2 }).update({
          tags: (tags) => tags.connect([{ id: 1 }, { id: 1 }]),
        });

        expect(rows(userTagRowsSql)).toEqual([
          { user_id: 1, tag_id: 1 },
          { user_id: 1, tag_id: 2 },
          { user_id: 2, tag_id: 1 },
          { user_id: 2, tag_id: 3 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() connect() with two different criteria for the same tag links it once',
    async () => {
      await withSqlite(twoUsersWithTagsSeedSql, async ({ users, rows }) => {
        await users.where({ id: 2 }).update({
          tags: (tags) => tags.connect([{ id: 1 }, { name: 'Rust' }]),
        });

        expect(rows(userTagRowsSql)).toEqual([
          { user_id: 1, tag_id: 1 },
          { user_id: 1, tag_id: 2 },
          { user_id: 2, tag_id: 1 },
          { user_id: 2, tag_id: 3 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() connect() to a tag that is already linked does nothing',
    async () => {
      await withSqlite(twoUsersWithTagsSeedSql, async ({ users, rows }) => {
        await users.where({ id: 1 }).update({
          tags: (tags) => tags.connect({ id: 1 }),
        });

        expect(rows(userTagRowsSql)).toEqual(seededUserTagRows);
      });
    },
    timeouts.databaseOperation,
  );
});

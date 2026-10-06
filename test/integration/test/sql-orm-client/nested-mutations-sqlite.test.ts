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
          .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag['id']!.asc()))
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
            posts.select('id', 'title', 'userId').orderBy((post) => post['id']!.asc()),
          )
          .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag['id']!.asc()))
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
          .include('posts', (posts) => posts.select('id').orderBy((post) => post['id']!.asc()))
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

  const twoParentsSeedSql = `
    insert into users values (1, 'Alice'), (2, 'Bob');
    insert into posts values (10, 'Draft', 1), (11, 'Kept', 1), (20, 'Draft', 2);
  `;
  const postRowsSql = 'select id, title, user_id from posts order by id';

  it(
    'update() where().updateAll() changes matching posts of the parent and leaves a matching post of another parent unchanged',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title').orderBy((post) => post['id']!.asc()),
          )
          .update({
            posts: (posts) => posts.where({ title: 'Draft' }).updateAll({ title: 'Published' }),
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Published' },
            { id: 11, title: 'Kept' },
          ],
        });
        expect(rows(postRowsSql)).toEqual([
          { id: 10, title: 'Published', user_id: 1 },
          { id: 11, title: 'Kept', user_id: 1 },
          { id: 20, title: 'Draft', user_id: 2 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() where().deleteAll() deletes matching posts of the parent and leaves a matching post of another parent unchanged',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title'))
          .update({
            posts: (posts) => posts.where({ title: 'Draft' }).deleteAll(),
          });

        expect(updated).toEqual({ id: 1, name: 'Alice', posts: [{ id: 11, title: 'Kept' }] });
        expect(rows(postRowsSql)).toEqual([
          { id: 11, title: 'Kept', user_id: 1 },
          { id: 20, title: 'Draft', user_id: 2 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() updateAll() and deleteAll() without where apply to every post of the parent only',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users, rows }) => {
        const alice = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title').orderBy((post) => post['id']!.asc()),
          )
          .update({ posts: (posts) => posts.updateAll({ title: 'Same' }) });

        expect(alice).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Same' },
            { id: 11, title: 'Same' },
          ],
        });

        const bob = await users
          .where({ id: 2 })
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title'))
          .update({ posts: (posts) => posts.deleteAll() });

        expect(bob).toEqual({ id: 2, name: 'Bob', posts: [] });
        expect(rows(postRowsSql)).toEqual([
          { id: 10, title: 'Same', user_id: 1 },
          { id: 11, title: 'Same', user_id: 1 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() where() takes a callback over the related model and chained calls combine with AND',
    async () => {
      await withSqlite(
        `${twoParentsSeedSql} insert into posts values (12, 'Draft', 1);`,
        async ({ users, rows }) => {
          const updated = await users
            .where({ id: 1 })
            .select('id', 'name')
            .include('posts', (posts) =>
              posts.select('id', 'title').orderBy((post) => post['id']!.asc()),
            )
            .update({
              posts: (posts) => [
                posts
                  .where((post) => post['id']!.gt(10))
                  .where({ title: 'Draft' })
                  .updateAll({ title: 'Late draft' }),
                posts.where((post) => post['id']!.lt(11)).deleteAll(),
              ],
            });

          expect(updated).toEqual({
            id: 1,
            name: 'Alice',
            posts: [
              { id: 11, title: 'Kept' },
              { id: 12, title: 'Late draft' },
            ],
          });
          expect(rows(postRowsSql)).toEqual([
            { id: 11, title: 'Kept', user_id: 1 },
            { id: 12, title: 'Late draft', user_id: 1 },
            { id: 20, title: 'Draft', user_id: 2 },
          ]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'update() updateAll() and deleteAll() change nothing when no post matches or the data is empty',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title').orderBy((post) => post['id']!.asc()),
          )
          .update({
            posts: (posts) => [
              posts.where({ title: 'Missing' }).updateAll({ title: 'Found' }),
              posts.where({ title: 'Missing' }).deleteAll(),
              posts.updateAll({}),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Draft' },
            { id: 11, title: 'Kept' },
          ],
        });
        expect(rows(postRowsSql)).toEqual([
          { id: 10, title: 'Draft', user_id: 1 },
          { id: 11, title: 'Kept', user_id: 1 },
          { id: 20, title: 'Draft', user_id: 2 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() runs updateAll() and deleteAll() in array order with create()',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('posts', (posts) =>
            posts.select('id', 'title').orderBy((post) => post['id']!.asc()),
          )
          .update({
            posts: (posts) => [
              posts.where({ title: 'Draft' }).updateAll({ title: 'Published' }),
              posts.create({ id: 30, title: 'Draft' }),
              posts.where({ title: 'Kept' }).deleteAll(),
              posts.create({ id: 31, title: 'Kept' }),
              posts.where({ title: 'Kept' }).updateAll({ title: 'Kept again' }),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          posts: [
            { id: 10, title: 'Published' },
            { id: 30, title: 'Draft' },
            { id: 31, title: 'Kept again' },
          ],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() rejects updateAll() data that sets the foreign key to the parent and rolls back',
    async () => {
      await withSqlite(twoParentsSeedSql, async ({ users, rows }) => {
        await expect(
          users.where({ id: 1 }).update({
            name: 'Renamed',
            posts: (posts) => [
              posts.where({ title: 'Kept' }).deleteAll(),
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

        expect(rows('select id, name from users order by id')).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        expect(rows(postRowsSql)).toEqual([
          { id: 10, title: 'Draft', user_id: 1 },
          { id: 11, title: 'Kept', user_id: 1 },
          { id: 20, title: 'Draft', user_id: 2 },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'updateAll() and deleteAll() are rejected in create() and on a to-one relation, writing nothing',
    async () => {
      await withSqlite(seedSql, async ({ users, posts, rows }) => {
        await expect(
          users.create({
            id: 3,
            name: 'Carol',
            // @ts-expect-error
            posts: (related) => related.deleteAll(),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'deleteAll', relation: 'posts' },
        });

        await expect(
          posts.where({ id: 10 }).update({
            title: 'Renamed',
            author: (author) => author.updateAll({ name: 'Renamed' }),
          }),
        ).rejects.toMatchObject({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: { kind: 'updateAll', relation: 'author', reason: 'to-one-relation' },
        });

        expect(rows('select id, name from users order by id')).toEqual([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]);
        expect(rows('select id, title from posts order by id')).toEqual([
          { id: 10, title: 'Old first' },
          { id: 11, title: 'Old second' },
          { id: 12, title: 'Unowned' },
        ]);
        expect(rows('select id, name from tags order by id')).toEqual([
          { id: 1, name: 'Rust' },
          { id: 2, name: 'TypeScript' },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

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
    'update() updateAll() changes a tag linked to this user and to another user, because it is related to this user',
    async () => {
      await withSqlite(
        `${twoUsersWithTagsSeedSql} insert into user_tags values (2, 1);`,
        async ({ users, rows }) => {
          const updated = await users
            .where({ id: 1 })
            .select('id', 'name')
            .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag['id']!.asc()))
            .update({
              tags: (tags) => tags.where({ name: 'Rust' }).updateAll({ name: 'Changed' }),
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
          expect(rows(userTagRowsSql)).toEqual([
            { user_id: 1, tag_id: 1 },
            { user_id: 1, tag_id: 2 },
            { user_id: 2, tag_id: 1 },
            { user_id: 2, tag_id: 3 },
          ]);
        },
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'update() updateAll() and deleteAll() without where on a junction relation apply to every tag linked to the user and to no other tag',
    async () => {
      await withSqlite(
        twoUsersWithTagsSeedSql,
        async ({ users, rows }) => {
          const alice = await users
            .where({ id: 1 })
            .select('id', 'name')
            .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag['id']!.asc()))
            .update({ tags: (tags) => tags.updateAll({ name: 'Changed' }) });

          expect(alice).toEqual({
            id: 1,
            name: 'Alice',
            tags: [
              { id: 1, name: 'Changed' },
              { id: 2, name: 'Changed' },
            ],
          });
          expect(rows(tagRowsSql)).toEqual([
            { id: 1, name: 'Changed' },
            { id: 2, name: 'Changed' },
            { id: 3, name: 'Go' },
          ]);

          const emptied = await users
            .where({ id: 1 })
            .select('id', 'name')
            .include('tags', (tags) => tags.select('id', 'name'))
            .update({ tags: (tags) => tags.deleteAll() });

          expect(emptied).toEqual({ id: 1, name: 'Alice', tags: [] });
          expect(rows(tagRowsSql)).toEqual([{ id: 3, name: 'Go' }]);
          expect(rows(userTagRowsSql)).toEqual([{ user_id: 2, tag_id: 3 }]);
        },
        cascadingSchemaSql,
      );
    },
    timeouts.databaseOperation,
  );

  it(
    'update() updateAll() and deleteAll() on a junction relation change nothing when no linked tag matches or the data is empty',
    async () => {
      await withSqlite(twoUsersWithTagsSeedSql, async ({ users, rows }) => {
        const updated = await users
          .where({ id: 1 })
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name').orderBy((tag) => tag['id']!.asc()))
          .update({
            tags: (tags) => [
              tags.where({ name: 'Go' }).updateAll({ name: 'Changed' }),
              tags.where({ name: 'Go' }).deleteAll(),
              tags.updateAll({}),
            ],
          });

        expect(updated).toEqual({
          id: 1,
          name: 'Alice',
          tags: [
            { id: 1, name: 'Rust' },
            { id: 2, name: 'TypeScript' },
          ],
        });
        expect(rows(tagRowsSql)).toEqual(seededTagRows);
        expect(rows(userTagRowsSql)).toEqual(seededUserTagRows);
      });
    },
    timeouts.databaseOperation,
  );
});

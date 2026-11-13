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
    note: field.column(textColumn).optional(),
  },
}).sql({ table: 'posts' });
const contract = defineContract({
  models: {
    User: UserBase.relations({
      posts: rel.hasMany(() => PostBase, { by: 'userId' }),
    }).sql({ table: 'users' }),
    Post: PostBase.relations({
      comments: rel.hasMany(() => Comment, { by: 'postId' }),
    }).sql({ table: 'posts' }),
    Comment,
  },
});

interface Harness {
  readonly users: Collection<typeof contract, 'User'>;
  readonly tables: () => { posts: unknown[]; comments: unknown[] };
}

async function withDatabase(fn: (harness: Harness) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-nested-create-on-conflict-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(`
    create table users (id integer primary key, name text not null);
    create table posts (id integer primary key, user_id integer, title text not null unique, note text);
    create table comments (id integer primary key, post_id integer not null, body text not null);
    insert into users values (1, 'Ada'), (9, 'Other');
    insert into posts values (10, 9, 'Taken', 'original');
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
  const read = (sql: string) => {
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
      users: new Collection({ runtime, context }, 'User', {
        namespaceId: soleDomainNamespaceId(contract.domain),
      }),
      tables: () => ({
        posts: read('select id, user_id, title, note from posts order by id'),
        comments: read('select id, post_id, body from comments order by id'),
      }),
    });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const takenPost = { id: 10, user_id: 9, title: 'Taken', note: 'original' };

describe('integration/nested create with onConflict skip on a one-to-many relation on SQLite', () => {
  it(
    'create() inserts and links the rows that do not collide, leaves a colliding row unchanged and unlinked, and runs callbacks only under inserted rows',
    async () => {
      await withDatabase(async ({ users, tables }) => {
        const created = await users
          .select('id', 'name')
          .include('posts', (posts) => posts.select('id', 'title').orderBy((post) => post.id.asc()))
          .create({
            id: 2,
            name: 'Grace',
            posts: (posts) =>
              posts.create(
                [
                  {
                    id: 10,
                    title: 'Clash',
                    note: 'changed',
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

        expect({ created, ...tables() }).toEqual({
          created: { id: 2, name: 'Grace', posts: [{ id: 11, title: 'New' }] },
          posts: [takenPost, { id: 11, user_id: 2, title: 'New', note: null }],
          comments: [{ id: 101, post_id: 11, body: 'Kept' }],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() skips a row that collides on the conflictOn field with an unrelated row and inserts the others',
    async () => {
      await withDatabase(async ({ users, tables }) => {
        const updated = await users
          .select('id')
          .include('posts', (posts) => posts.select('id', 'title').orderBy((post) => post.id.asc()))
          .where({ id: 1 })
          .update({
            posts: (posts) =>
              posts.create(
                [
                  { id: 20, title: 'Taken', note: 'changed' },
                  { id: 21, title: 'Fresh' },
                ],
                { onConflict: 'skip', conflictOn: ['title'] },
              ),
          });

        expect({ updated, ...tables() }).toEqual({
          updated: { id: 1, posts: [{ id: 21, title: 'Fresh' }] },
          posts: [takenPost, { id: 21, user_id: 1, title: 'Fresh', note: null }],
          comments: [],
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() refuses a row that gives no value for any conflict key and writes nothing',
    async () => {
      await withDatabase(async ({ users, tables }) => {
        await expect(
          users.where({ id: 1 }).update({
            posts: (posts) =>
              posts.create([{ id: 20, title: 'No note' }], {
                onConflict: 'skip',
                conflictOn: ['note'],
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
              conflictKeys: [['note']],
            },
          }),
        );
        expect(tables()).toEqual({ posts: [takenPost], comments: [] });
      });
    },
    timeouts.databaseOperation,
  );
});

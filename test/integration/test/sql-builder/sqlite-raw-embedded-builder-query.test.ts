import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { sqliteRawCodecInferer } from '@internal/adapter-sqlite/adapter';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createRawLane, sql } from '@internal/sql-builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const User = model('User', {
  fields: {
    id: field.column(integerColumn).id(),
    name: field.column(textColumn),
  },
}).sql({ table: 'users' });

const Post = model('Post', {
  fields: {
    id: field.column(integerColumn).id(),
    userId: field.column(integerColumn).column('user_id'),
    title: field.column(textColumn),
    views: field.column(integerColumn),
  },
}).sql({ table: 'posts' });

const Archive = model('Archive', {
  fields: {
    id: field.column(integerColumn).id(),
    title: field.column(textColumn),
    author: field.column(textColumn),
    note: field.column(textColumn),
  },
}).sql({ table: 'archive' });

const contract = defineContract({ models: { User, Post, Archive } });

describe('integration: SQLite raw statement with an embedded builder query', {
  timeout: timeouts.databaseOperation,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-raw-embedded-builder-query-'));
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const db = sql({ context, rawCodecInferer: sqliteRawCodecInferer });
  const raw = createRawLane({ context, rawCodecInferer: sqliteRawCodecInferer });
  let runtime: SqliteRuntimeImpl;

  beforeAll(async () => {
    const path = join(directory, 'test.db');
    const database = new DatabaseSync(path);
    database.exec(`
      create table users (id integer primary key, name text not null);
      create table posts (id integer primary key, user_id integer not null, title text not null, views integer not null);
      create table archive (id integer primary key, title text not null, author text not null, note text not null);
      insert into users values (1, 'Alice'), (2, 'Bob');
      insert into posts values (10, 1, 'Hello', 100), (11, 1, 'Quiet', 5), (12, 2, 'Loud', 300);
    `);
    database.close();

    const instance = instantiateExecutionStack(stack);
    if (instance.adapter === undefined || instance.driver === undefined) {
      throw new InternalError('SQLite execution stack is missing its adapter or driver');
    }
    await instance.driver.connect({ kind: 'path', path });
    runtime = new SqliteRuntimeImpl({
      context,
      adapter: instance.adapter,
      driver: instance.driver,
      closeRefusal: undefined,
    });
  });

  afterAll(async () => {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts the rows of an unparenthesised embedded select, with params before, inside and after it', async () => {
    const users = db[UNBOUND_NAMESPACE_ID].users;
    const posts = db[UNBOUND_NAMESPACE_ID].posts;
    const archive = db[UNBOUND_NAMESPACE_ID].archive;
    const copies = posts
      .innerJoin(users, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
      .select((f, fns) => ({
        id: f.posts.id,
        title: f.posts.title,
        author: f.users.name,
        note: fns.raw`${'archived'}`.returns('sqlite/text@1'),
      }))
      .where((f, fns) => fns.gt(f.posts.views, 50));

    const plan = raw.sql`
      WITH batch AS (SELECT ${'batch-7'} AS label)
      INSERT INTO archive (id, title, author, note)
      ${copies}
      RETURNING id, title, author, note, (SELECT label FROM batch) AS batch, id + ${1000} AS shifted_id
    `
      .returnsRow({
        id: archive.columns.id,
        title: archive.columns.title,
        author: archive.columns.author,
        note: archive.columns.note,
        batch: 'sqlite/text@1',
        shifted_id: 'sqlite/integer@1',
      })
      .build();

    const rows = await runtime.query(plan);
    expect([...rows].sort((a, b) => a.id - b.id)).toEqual([
      {
        id: 10,
        title: 'Hello',
        author: 'Alice',
        note: 'archived',
        batch: 'batch-7',
        shifted_id: 1010,
      },
      {
        id: 12,
        title: 'Loud',
        author: 'Bob',
        note: 'archived',
        batch: 'batch-7',
        shifted_id: 1012,
      },
    ]);

    const stored = await runtime.query(
      archive.select('id', 'title', 'author', 'note').orderBy('id').build(),
    );
    expect(stored).toEqual([
      { id: 10, title: 'Hello', author: 'Alice', note: 'archived' },
      { id: 12, title: 'Loud', author: 'Bob', note: 'archived' },
    ]);
  });
});

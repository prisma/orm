import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { sqliteRawCodecInferer } from '@internal/adapter-sqlite/adapter';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sql } from '@internal/sql-builder/runtime';
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
  },
}).sql({ table: 'posts' });

const contract = defineContract({ models: { User, Post } });

describe('integration: SQLite comparison projections', {
  timeout: timeouts.databaseOperation,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-comparison-projections-'));
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const db = sql({ context, rawCodecInferer: sqliteRawCodecInferer });
  let runtime: SqliteRuntimeImpl;

  beforeAll(async () => {
    const path = join(directory, 'test.db');
    const database = new DatabaseSync(path);
    database.exec(`
      create table users (id integer primary key, name text not null);
      create table posts (id integer primary key, user_id integer not null);
      insert into users values (1, 'Alice'), (2, 'Bob');
      insert into posts values (10, 1);
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

  it('reads fns.eq and fns.exists projections as the integers SQLite returns', async () => {
    const users = db[UNBOUND_NAMESPACE_ID].users;
    const posts = db[UNBOUND_NAMESPACE_ID].posts;
    const rows = await runtime.query(
      users
        .select('id')
        .select((f, fns) => ({
          isAlice: fns.eq(f.name, 'Alice'),
          hasPosts: fns.exists(
            posts.select('id').where((pf, pfns) => pfns.eq(pf.posts.user_id, f.users.id)),
          ),
        }))
        .orderBy('id')
        .build(),
    );

    expect(rows).toEqual([
      { id: 1, isAlice: 1, hasPosts: 1 },
      { id: 2, isAlice: 0, hasPosts: 0 },
    ]);
  });
});

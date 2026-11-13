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
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const wideColumns = Array.from({ length: 598 }, (_, index) => `c${598 - index}`);

const Comment = model('Comment', {
  fields: {
    id: field.column(integerColumn).id(),
    postId: field.column(integerColumn).column('post_id'),
    ...Object.fromEntries(wideColumns.map((name) => [name, field.column(textColumn)])),
  },
}).sql({ table: 'wide_comments' });

const Post = model('Post', {
  fields: { id: field.column(integerColumn).id() },
  relations: { comments: rel.hasMany(() => Comment, { by: 'postId' }) },
}).sql({ table: 'wide_posts' });

const contract = defineContract({ models: { Post, Comment } });
const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});
const context = createExecutionContext({ contract, stack });

describe('a SQLite to-many include of a model with more columns than one json_object call takes', () => {
  let directory: string | undefined;
  let database: DatabaseSync | undefined;
  let runtime: SqliteRuntimeImpl | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-wide-'));
    const path = join(directory, 'test.db');
    database = new DatabaseSync(path);
    database.exec(`
      create table wide_posts (id integer primary key);
      create table wide_comments (
        id integer primary key,
        post_id integer not null,
        ${wideColumns.map((name) => `${name} text`).join(', ')}
      );
      insert into wide_posts (id) values (1);
      insert into wide_comments (id, post_id, ${wideColumns.join(', ')})
        values (1, 1, ${wideColumns.map((name) => `'${name}'`).join(', ')});
    `);
    const instance = instantiateExecutionStack(stack);
    if (instance.adapter === undefined || instance.driver === undefined) {
      throw new InternalError('SQLite execution stack is missing its adapter or driver');
    }
    await instance.driver.connect({ kind: 'path', path });
    runtime = new SqliteRuntimeImpl({
      context,
      adapter: instance.adapter,
      driver: instance.driver,
    });
  });

  afterAll(async () => {
    await runtime?.close();
    database?.close();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  });

  it('returns every column of the related rows in field order', async () => {
    const namespace = { namespaceId: soleDomainNamespaceId(contract.domain) };

    const rows = await new Collection({ runtime: runtime!, context }, 'Post', namespace)
      .include('comments')
      .all();

    const comment = {
      id: 1,
      postId: 1,
      ...Object.fromEntries(wideColumns.map((name) => [name, name])),
    };
    expect(rows).toEqual([{ id: 1, comments: [comment] }]);
    expect(Object.keys(rows[0]?.comments[0] ?? {})).toEqual(Object.keys(comment));
  });
});

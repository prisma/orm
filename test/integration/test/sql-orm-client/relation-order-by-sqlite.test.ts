// Runs a filtered relation-count order on SQLite, where parameters bind by
// position: the WHERE parameter and the count predicate parameter must reach
// their own `?` placeholders.
//
// Seed data (filtered = posts with more than 10 views):
//
//   User  post views      filtered  unfiltered
//   1     5, 50           1         2
//   2     20, 30, 40      3         3
//   3     1, 2, 3, 4      0         4

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

const User = model('User', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'users' });
const Post = model('Post', {
  fields: {
    id: field.column(integerColumn).id(),
    userId: field.column(integerColumn).column('user_id'),
    views: field.column(integerColumn),
  },
  relations: { author: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }) },
}).sql({ table: 'posts' });
const contract = defineContract({
  models: {
    User: User.relations({ posts: rel.hasMany(() => Post, { by: 'userId' }) }).sql({
      table: 'users',
    }),
    Post,
  },
});

const postViews: ReadonlyArray<readonly [userId: number, views: number]> = [
  [1, 5],
  [1, 50],
  [2, 20],
  [2, 30],
  [2, 40],
  [3, 1],
  [3, 2],
  [3, 3],
  [3, 4],
];

async function withUsers(
  fn: (users: Collection<typeof contract, 'User'>) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-relation-order-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(
    'create table users (id integer primary key, name text not null); create table posts (id integer primary key, user_id integer not null, views integer not null);',
  );
  for (const id of [1, 2, 3]) {
    database.prepare('insert into users values (?, ?)').run(id, `user${id}`);
  }
  postViews.forEach(([userId, views], index) => {
    database.prepare('insert into posts values (?, ?, ?)').run(index + 1, userId, views);
  });
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
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver });
  try {
    await fn(
      new Collection({ runtime, context }, 'User', {
        namespaceId: soleDomainNamespaceId(contract.domain),
      }),
    );
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('integration/relation-order-by on SQLite', () => {
  it(
    'orders by a filtered to-many count with a WHERE parameter before it',
    async () => {
      await withUsers(async (users) => {
        const rows = await users
          .select('id')
          .where((u) => u.id.gt(0))
          .orderBy([(u) => u.posts.count((p) => p['views']!.gt(10)).desc(), (u) => u.id.asc()])
          .all();

        expect(rows).toEqual([{ id: 2 }, { id: 1 }, { id: 3 }]);
      });
    },
    timeouts.databaseOperation,
  );
});

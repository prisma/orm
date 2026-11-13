import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection } from '@internal/sql-orm-client';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlMiddleware,
} from '@internal/sql-runtime';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const User = model('User', {
  fields: {
    id: field.column(integerColumn).id(),
    name: field.column(textColumn),
    email: field.column(textColumn).unique(),
  },
}).sql({ table: 'users' });

const contract = defineContract({ models: { User } });

const schemaSql = `
  create table users (id integer primary key, name text not null, email text not null unique);
  insert into users values (1, 'Ada', 'ada@example.com'), (2, 'Grace', 'grace@example.com');
`;

interface Harness {
  readonly users: Collection<typeof contract, 'User'>;
  readonly statements: string[];
  rows(): unknown[];
}

async function withSqlite(fn: (harness: Harness) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-unique-key-writes-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(schemaSql);
  const statements: string[] = [];
  const record = async (plan: { readonly sql: string }) => {
    statements.push(plan.sql);
    return undefined;
  };
  const recorder: SqlMiddleware = {
    name: 'statement-recorder',
    intercept: { onQuery: record, onExecute: record },
  };
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
  const runtime = new SqliteRuntimeImpl({
    context,
    adapter,
    driver,
    middleware: [recorder],
    closeRefusal: undefined,
  });
  try {
    await fn({
      users: new Collection({ runtime, context }, 'User', {
        namespaceId: soleDomainNamespaceId(contract.domain),
      }),
      statements,
      rows: () => database.prepare('select id, name from users order by id').all(),
    });
  } finally {
    await runtime.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('integration/update() and delete() by a unique key on SQLite', () => {
  it(
    'where({ id }).update() sends one statement and returns the updated row',
    async () => {
      await withSqlite(async ({ users, statements, rows }) => {
        const updated = await users
          .select('id', 'name')
          .where({ id: 1 })
          .update({ name: 'Ada Lovelace' });

        expect({ updated, statements: statements.length }).toEqual({
          updated: { id: 1, name: 'Ada Lovelace' },
          statements: 1,
        });
        expect(rows()).toEqual([
          { id: 1, name: 'Ada Lovelace' },
          { id: 2, name: 'Grace' },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'whereUnique() on a unique column sends one statement for update() and returns the updated row',
    async () => {
      await withSqlite(async ({ users, statements }) => {
        const updated = await users
          .select('id', 'name')
          .whereUnique({ email: 'grace@example.com' })
          .update({ name: 'Grace Hopper' });

        expect({ updated, statements: statements.length }).toEqual({
          updated: { id: 2, name: 'Grace Hopper' },
          statements: 1,
        });
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'where({ id }).delete() sends one statement and returns the deleted row',
    async () => {
      await withSqlite(async ({ users, statements, rows }) => {
        const deleted = await users.select('id', 'name').where({ id: 1 }).delete();

        expect({ deleted, statements: statements.length }).toEqual({
          deleted: { id: 1, name: 'Ada' },
          statements: 1,
        });
        expect(rows()).toEqual([{ id: 2, name: 'Grace' }]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() and delete() by a key that matches no row send one statement each and return null',
    async () => {
      await withSqlite(async ({ users, statements, rows }) => {
        const updated = await users
          .select('id', 'name')
          .where({ id: 3 })
          .update({ name: 'Nobody' });
        const deleted = await users.select('id', 'name').where({ id: 3 }).delete();

        expect({ updated, deleted, statements: statements.length }).toEqual({
          updated: null,
          deleted: null,
          statements: 2,
        });
        expect(rows()).toEqual([
          { id: 1, name: 'Ada' },
          { id: 2, name: 'Grace' },
        ]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'update() and delete() by a condition that pins no key send two statements each',
    async () => {
      await withSqlite(async ({ users, statements, rows }) => {
        const updated = await users
          .select('id', 'name')
          .where({ name: 'Ada' })
          .update({ name: 'Ada Lovelace' });
        const deleted = await users.select('id', 'name').where({ name: 'Grace' }).delete();

        expect({ updated, deleted, statements: statements.length }).toEqual({
          updated: { id: 1, name: 'Ada Lovelace' },
          deleted: { id: 2, name: 'Grace' },
          statements: 4,
        });
        expect(rows()).toEqual([{ id: 1, name: 'Ada Lovelace' }]);
      });
    },
    timeouts.databaseOperation,
  );
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
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
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const User = model('User', {
  fields: {
    id: field.column(integerColumn).id(),
    name: field.column(textColumn),
    email: field.column(textColumn),
  },
}).sql({ table: 'hook_users' });

const contract = defineContract({ models: { User } });
const namespaceId = UNBOUND_NAMESPACE_ID;

async function createRuntime(path: string, middleware: readonly SqlMiddleware[] = []) {
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const instance = instantiateExecutionStack(stack);
  const adapter = instance.adapter;
  const driver = instance.driver;
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  return {
    context,
    runtime: new SqliteRuntimeImpl({
      context,
      adapter,
      driver,
      middleware,
      closeRefusal: undefined,
    }),
  };
}

describe('an ORM write whose transaction activityEnded hook throws after COMMIT', () => {
  it('rejects with the hook error, sends no ROLLBACK, and keeps the committed write', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pn-hook-after-commit-'));
    const path = join(directory, 'test.db');
    const database = new DatabaseSync(path);
    database.exec(`
      create table hook_users (
        id integer primary key,
        name text not null,
        email text not null
      );
      insert into hook_users (id, name, email) values (1, 'Stale', 'a@example.com');
    `);
    database.close();

    const hookError = new Error('transaction ended hook failed');
    const transactionStatements: string[] = [];
    const failingEnd: SqlMiddleware = {
      name: 'failing-transaction-end',
      familyId: 'sql',
      async activityEnded(activity, _result, ctx) {
        if (activity.kind === 'transaction') throw hookError;
        if (ctx.inTransaction()) transactionStatements.push('statement');
      },
    };

    let setup: Awaited<ReturnType<typeof createRuntime>> | undefined;
    try {
      setup = await createRuntime(path, [failingEnd]);
      const users = new Collection({ runtime: setup.runtime, context: setup.context }, 'User', {
        namespaceId,
      });

      await expect(users.where({ id: 1 }).update({ name: 'Updated' })).rejects.toBe(hookError);

      expect(transactionStatements.length).toBeGreaterThan(0);
      const check = new DatabaseSync(path);
      try {
        expect(check.prepare('select name from hook_users where id = 1').get()).toEqual({
          name: 'Updated',
        });
      } finally {
        check.close();
      }
    } finally {
      await setup?.runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('an ORM write whose transaction activityEnded hook throws after ROLLBACK', () => {
  it('rejects with the write error, not the hook error', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pn-hook-after-rollback-'));
    const path = join(directory, 'test.db');
    const database = new DatabaseSync(path);
    database.exec(`
      create table hook_users (
        id integer primary key,
        name text not null,
        email text not null
      );
      insert into hook_users (id, name, email) values (1, 'Stale', 'a@example.com');
    `);
    database.close();

    const writeError = new Error('update blocked');
    const failingEndAndUpdate: SqlMiddleware = {
      name: 'failing-end-and-update',
      familyId: 'sql',
      beforeEncode(exec) {
        if (exec.sql.trimStart().toLowerCase().startsWith('update')) throw writeError;
      },
      async activityEnded(activity) {
        if (activity.kind === 'transaction') throw new Error('transaction ended hook failed');
      },
    };

    let setup: Awaited<ReturnType<typeof createRuntime>> | undefined;
    try {
      setup = await createRuntime(path, [failingEndAndUpdate]);
      const users = new Collection({ runtime: setup.runtime, context: setup.context }, 'User', {
        namespaceId,
      });

      await expect(users.where({ id: 1 }).update({ name: 'Updated' })).rejects.toBe(writeError);

      const check = new DatabaseSync(path);
      try {
        expect(check.prepare('select name from hook_users where id = 1').get()).toEqual({
          name: 'Stale',
        });
      } finally {
        check.close();
      }
    } finally {
      await setup?.runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { sqliteAdapterCapabilities } from '@internal/adapter-sqlite/adapter';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { rejectionShape } from './error-shape';
import type { Contract } from './fixtures/connect-without-returning-sqlite/generated/contract';
import contractJson from './fixtures/connect-without-returning-sqlite/generated/contract.json' with {
  type: 'json',
};

/**
 * A nested create with onConflict "connect" through variant() on a contract emitted against a SQLite adapter that does not report `returning`: the insert names its conflict columns, and the ORM reads the linked row back by them to check its variant.
 */

const schema = `
  create table users (id integer primary key, name text not null);
  create table tasks (id integer primary key, title text not null, type text not null, owner_id integer references users(id), severity text, priority integer);
  insert into users (id, name) values (1, 'Ada');
  insert into tasks (id, title, type, owner_id, severity, priority) values
    (1, 'Dark mode', 'feature', null, null, 1),
    (2, 'Crash', 'bug', null, 'high', null);
`;

const { returning: _returning, ...sqlCapabilities } = sqliteAdapterCapabilities.sql;
const adapterWithoutReturning = { ...sqliteAdapter, capabilities: { sql: sqlCapabilities } };

type Db = ReturnType<typeof orm<Contract>>[typeof UNBOUND_NAMESPACE_ID];

async function withDatabase(run: (db: Db, tasks: () => unknown[]) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-connect-without-returning-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(schema);
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: adapterWithoutReturning,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({
    contract: contractFromJson<Contract>(contractJson),
    stack,
  });
  const instance = instantiateExecutionStack(stack);
  const { adapter, driver } = instance;
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver, closeRefusal: undefined });
  const tasks = () =>
    database
      .prepare('select id, title, type, owner_id, severity from tasks order by id')
      .all()
      .map((row) => ({ ...row }));
  try {
    await run(orm({ context, runtime })[UNBOUND_NAMESPACE_ID], tasks);
  } finally {
    await runtime.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('integration/nested create with onConflict connect through variant() without RETURNING on sqlite', () => {
  it('refuses a colliding row of another variant and leaves it unlinked, and links a colliding row of the variant', async () => {
    await withDatabase(async (db, tasks) => {
      const wrong = await rejectionShape(
        db.User.where({ id: 1 }).update({
          tasks: (task) =>
            task.variant('bug').create({ id: 1, title: 'Clash' }, { onConflict: 'connect' }),
        }),
      );
      const unchanged = tasks();
      const linked = await db.User.where({ id: 1 }).update({
        tasks: (task) =>
          task.variant('bug').create({ id: 2, title: 'Clash' }, { onConflict: 'connect' }),
      });

      expect({ wrong, unchanged, linked, tasks: tasks() }).toEqual({
        wrong: expect.objectContaining({
          code: 'ORM.RELATION_ROW_MISSING',
          message:
            'create() nested mutation for relation "tasks" found a row of another variant than "bug" on its conflict key',
          meta: { kind: 'create', relation: 'tasks', variant: 'bug' },
        }),
        unchanged: [
          { id: 1, title: 'Dark mode', type: 'feature', owner_id: null, severity: null },
          { id: 2, title: 'Crash', type: 'bug', owner_id: null, severity: 'high' },
        ],
        linked: { id: 1, name: 'Ada' },
        tasks: [
          { id: 1, title: 'Dark mode', type: 'feature', owner_id: null, severity: null },
          { id: 2, title: 'Crash', type: 'bug', owner_id: 1, severity: 'high' },
        ],
      });
    });
  });
});

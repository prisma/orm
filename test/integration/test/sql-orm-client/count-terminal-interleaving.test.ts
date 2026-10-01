import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sql } from '@internal/sql-builder/runtime';
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
}).sql({ table: 'count_users' });

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

describe('SQL count terminal write-derived interleaving', () => {
  it('includes a newly matching row committed immediately before update execution', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pn-count-terminal-'));
    const path = join(directory, 'test.db');
    const database = new DatabaseSync(path);
    database.exec(`
      create table count_users (
        id integer primary key,
        name text not null,
        email text not null
      );
      insert into count_users (id, name, email) values (1, 'Stale', 'a@example.com');
    `);
    database.close();

    let primary: Awaited<ReturnType<typeof createRuntime>> | undefined;
    let secondary: Awaited<ReturnType<typeof createRuntime>> | undefined;
    try {
      secondary = await createRuntime(path);
      const secondarySql = sql({
        context: secondary.context,
        rawCodecInferer: sqliteAdapter.rawCodecInferer,
      });
      const interleavedInsert = secondarySql[namespaceId].count_users
        .insert([{ id: 2, name: 'Stale', email: 'b@example.com' }])
        .build();

      let armed = true;
      let interleavings = 0;
      const interleave: SqlMiddleware = {
        name: 'insert-before-count-terminal-dml',
        familyId: 'sql',
        async beforeExecute(exec) {
          if (!armed || !exec.sql.trimStart().toLowerCase().startsWith('update')) return;
          armed = false;
          interleavings++;
          await secondary!.runtime.execute(interleavedInsert);
        },
      };

      primary = await createRuntime(path, [interleave]);
      const users = new Collection({ runtime: primary.runtime, context: primary.context }, 'User', {
        namespaceId,
      });

      const count = await users.where({ name: 'Stale' }).updateAndCount({ name: 'Updated' });

      // A pre-read count would have observed only row 1, then returned 1 even though this
      // middleware inserts row 2 before the UPDATE. A write-derived count must return 2.
      expect(interleavings).toBe(1);
      expect(count).toBe(2);
      const rows = await primary.runtime
        .query<{ id: number; name: string }>(
          sql({ context: primary.context, rawCodecInferer: sqliteAdapter.rawCodecInferer })
            [namespaceId].count_users.select('id', 'name')
            .build(),
        )
        .toArray();
      expect([...rows].sort((left, right) => left.id - right.id)).toEqual([
        { id: 1, name: 'Updated' },
        { id: 2, name: 'Updated' },
      ]);
    } finally {
      await primary?.runtime.close();
      await secondary?.runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

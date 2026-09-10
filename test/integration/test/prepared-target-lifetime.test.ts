import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { integerColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import pgvector from '@internal/extension-pgvector/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type PreparedExecution,
  type PreparedStatement,
  type Runtime,
} from '@internal/sql-runtime';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { getTestContract } from './sql-orm-client/helpers';

interface Environment {
  runtime: Runtime;
  rows: PreparedStatement<Record<string, never>, { counter: unknown }>;
  stats: PreparedExecution<Record<string, never>>;
  counter(): Promise<unknown>;
  close(): Promise<void>;
}

async function postgresEnvironment(): Promise<Environment> {
  const database = await createDevDatabase();
  const client = new Client({ connectionString: database.connectionString });
  await client.connect();
  await client.query(
    'CREATE TABLE lifetime (counter int4 NOT NULL); INSERT INTO lifetime VALUES (0)',
  );
  const contract = getTestContract();
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: {
      ...postgresDriver,
      create: () => postgresDriver.create({ cursor: { disabled: true } }),
    },
    extensions: [pgvector],
  });
  const context = createExecutionContext({ contract, stack });
  const instance = instantiateExecutionStack(stack);
  const driver = instance.driver;
  if (!driver) throw new Error('driver missing');
  await driver.connect({ kind: 'pgClient', client });
  const runtime = new PostgresRuntimeImpl({
    context,
    adapter: instance.adapter,
    driver,
    verifyMarker: false,
  });
  const rows = await runtime.prepare({}, () =>
    planFromAst<{ counter: number }>(
      RawQueryAst.rows(['UPDATE lifetime SET counter = counter + 1 RETURNING counter'], {
        counter: { codecId: 'pg/int4@1', nullable: false },
      }),
      contract,
    ),
  );
  const stats = await runtime.prepare({}, () =>
    planFromAst<AffectedCount>(
      RawQueryAst.affectedCount(['UPDATE lifetime SET counter = counter + 1']),
      contract,
    ),
  );
  return {
    runtime,
    rows,
    stats,
    async counter() {
      return (await client.query('SELECT counter FROM lifetime')).rows[0]?.counter;
    },
    async close() {
      await runtime.close();
      await client.end();
      await database.close();
    },
  };
}

const sqliteContract = defineContract({
  models: {
    Lifetime: model('Lifetime', { fields: { counter: field.column(integerColumn).id() } }).sql({
      table: 'lifetime',
    }),
  },
});

async function sqliteEnvironment(): Promise<Environment> {
  const directory = mkdtempSync(join(tmpdir(), 'prepared-lifetime-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(
    'CREATE TABLE lifetime (counter integer NOT NULL); INSERT INTO lifetime VALUES (0)',
  );
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract: sqliteContract, stack });
  const instance = instantiateExecutionStack(stack);
  const driver = instance.driver;
  if (!driver) throw new Error('driver missing');
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter: instance.adapter, driver });
  const rows = await runtime.prepare({}, () =>
    planFromAst<{ counter: number }>(
      RawQueryAst.rows(['UPDATE lifetime SET counter = counter + 1 RETURNING counter'], {
        counter: { codecId: 'sqlite/integer@1', nullable: false },
      }),
      sqliteContract,
    ),
  );
  const stats = await runtime.prepare({}, () =>
    planFromAst<AffectedCount>(
      RawQueryAst.affectedCount(['UPDATE lifetime SET counter = counter + 1']),
      sqliteContract,
    ),
  );
  return {
    runtime,
    rows,
    stats,
    async counter() {
      return database.prepare('SELECT counter FROM lifetime').get()?.['counter'];
    },
    async close() {
      await runtime.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const [target, setup] of [
  ['Postgres', postgresEnvironment],
  ['SQLite', sqliteEnvironment],
] as const) {
  describe(`SQL prepared target lifetime on ${target}`, () => {
    for (const ending of ['commit', 'rollback'] as const) {
      it(
        `rejects rows, delayed iteration and statistics after ${ending} without executing`,
        async () => {
          const env = await setup();
          try {
            const connection = await env.runtime.connection();
            try {
              const transaction = await connection.transaction();
              expect(await env.rows.query(transaction, {})).toEqual([{ counter: 1 }]);
              expect(await env.stats.execute(transaction, {})).toEqual({ affectedRows: 1 });
              const delayed = env.rows.query(transaction, {});
              await transaction[ending]();
              await expect.soft(delayed.toArray()).rejects.toThrow();
              await expect.soft(env.rows.query(transaction, {}).toArray()).rejects.toThrow();
              await expect.soft(env.stats.execute(transaction, {})).rejects.toThrow();
              expect(await env.counter()).toBe(ending === 'commit' ? 2 : 0);
            } finally {
              await connection.release();
            }
          } finally {
            await env.close();
          }
        },
        timeouts.spinUpPpgDev,
      );
    }
    it(
      'rejects rows and statistics after release without executing',
      async () => {
        const env = await setup();
        try {
          const connection = await env.runtime.connection();
          expect(await env.rows.query(connection, {})).toEqual([{ counter: 1 }]);
          const delayed = env.rows.query(connection, {});
          await connection.release();
          await expect.soft(delayed.toArray()).rejects.toThrow();
          await expect.soft(env.rows.query(connection, {}).toArray()).rejects.toThrow();
          await expect.soft(env.stats.execute(connection, {})).rejects.toThrow();
          expect(await env.counter()).toBe(1);
        } finally {
          await env.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
}

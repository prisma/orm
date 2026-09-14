import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/runtime';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import pgvector from '@internal/extension-pgvector/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import { Collection, createPreparedRowQuery, type RowQuery } from '@internal/sql-orm-client';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Runtime,
  type RuntimeTransaction,
} from '@internal/sql-runtime';
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { Client } from 'pg';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { getTestContract } from './helpers';

type Row = { name: string; posts: { title: unknown }[] };
interface Environment {
  runtime: Runtime;
  all(): RowQuery<Record<string, unknown>, AsyncIterableResult<Row>>;
  first(): RowQuery<Record<string, unknown>, Promise<Row | null>>;
  insert(transaction: RuntimeTransaction): Promise<void>;
  loweringCount(): number;
  queryCount(): number;
  close(): Promise<void>;
}

async function postgresEnvironment(name: string): Promise<Environment> {
  const database = await createDevDatabase({ databaseIdleTimeoutMillis: timeouts.spinUpPpgDev });
  const client = new Client({ connectionString: database.connectionString });
  await client.connect();
  await client.query(
    'create table users (id int4 primary key, name text, email text, invited_by_id int4, address jsonb); create table posts (id int4 primary key, title text, user_id int4, views int4);',
  );
  await client.query('insert into users (id, name, email) values (1, $1, $2)', [
    name,
    `${name}@example.com`,
  ]);
  await client.query('insert into posts (id, title, user_id, views) values (1, $1, 1, 0)', [
    `${name} post`,
  ]);
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
  const lower = vi.fn(instance.adapter.lower.bind(instance.adapter));
  const driverQuery = vi.spyOn(driver, 'query');
  const runtime = new PostgresRuntimeImpl({
    context,
    adapter: { ...instance.adapter, lower },
    driver,
    verifyMarker: false,
  });
  const users = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
  const selected = users.select('name').include('posts', (posts) => posts.select('title'));
  return {
    runtime,
    all: () => selected.where({ id: 1 }).prepared.all(),
    first: () => selected.prepared.first({ id: 2 }),
    async insert(transaction) {
      const scoped = new Collection({ runtime: transaction, context }, 'User', {
        namespaceId: 'public',
      });
      await scoped.create({
        id: 2,
        name: 'Transaction',
        email: 'tx@example.com',
        invitedById: null,
        address: null,
      });
    },
    loweringCount: () => lower.mock.calls.length,
    queryCount: () => driverQuery.mock.calls.length,
    async close() {
      await runtime.close();
      await client.end();
      await database.close();
    },
  };
}

const User = model('User', {
  fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
}).sql({ table: 'users' });
const Post = model('Post', {
  fields: {
    id: field.column(integerColumn).id(),
    title: field.column(textColumn),
    userId: field.column(integerColumn).column('user_id'),
  },
  relations: { author: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }) },
}).sql({ table: 'posts' });
const sqliteContract = defineContract({
  models: {
    User: User.relations({ posts: rel.hasMany(() => Post, { by: 'userId' }) }).sql({
      table: 'users',
    }),
    Post,
  },
});

async function sqliteEnvironment(name: string): Promise<Environment> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-prepared-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(
    'create table users (id integer primary key, name text); create table posts (id integer primary key, title text, user_id integer);',
  );
  database.prepare('insert into users values (1, ?)').run(name);
  database.prepare('insert into posts values (1, ?, 1)').run(`${name} post`);
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
  const lower = vi.fn(instance.adapter.lower.bind(instance.adapter));
  const driverQuery = vi.spyOn(driver, 'query');
  const runtime = new SqliteRuntimeImpl({
    context,
    adapter: { ...instance.adapter, lower },
    driver,
  });
  const namespaceId = soleDomainNamespaceId(sqliteContract.domain);
  const users = new Collection({ runtime, context }, 'User', { namespaceId });
  const selected = users.select('name').include('posts', (posts) => posts.select('title'));
  expectTypeOf(selected.all).returns.toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(selected.prepared.all().consume).returns.toEqualTypeOf<
    ReturnType<typeof selected.all>
  >();
  expectTypeOf(selected.prepared.first().consume).returns.toEqualTypeOf<
    ReturnType<typeof selected.first>
  >();
  return {
    runtime,
    all: () => selected.where({ id: 1 }).prepared.all(),
    first: () => selected.prepared.first({ id: 2 }),
    async insert(transaction) {
      await new Collection({ runtime: transaction, context }, 'User', { namespaceId }).create({
        id: 2,
        name: 'Transaction',
      });
    },
    loweringCount: () => lower.mock.calls.length,
    queryCount: () => driverQuery.mock.calls.length,
    async close() {
      await runtime.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const [name, setup] of [
  ['Postgres', postgresEnvironment],
  ['SQLite', sqliteEnvironment],
] as const) {
  describe(`prepared ORM rows on ${name}`, () => {
    it(
      'prepares once and queries explicit runtime, transaction and connection targets',
      async () => {
        const authoring = await setup('Authoring');
        let target: Environment | undefined;
        try {
          target = await setup('Target');
          const description = authoring.all();
          const query = vi.spyOn(authoring.runtime, 'query');
          const callback = vi.fn(() => description);
          const sql = await authoring.runtime.prepare({}, callback);
          const prepared = createPreparedRowQuery(description, sql);
          expect(callback).toHaveBeenCalledOnce();
          expect(authoring.loweringCount()).toBe(1);
          expect(query).not.toHaveBeenCalled();
          expect(authoring.queryCount()).toBe(0);
          expect(target.queryCount()).toBe(0);
          const result = prepared.query(target.runtime, {});
          expect(result[Symbol.asyncIterator]).toBeTypeOf('function');
          expect(await result).toEqual([{ name: 'Target', posts: [{ title: 'Target post' }] }]);
          expect(await prepared.query(authoring.runtime, {})).toEqual([
            { name: 'Authoring', posts: [{ title: 'Authoring post' }] },
          ]);
          expect(callback).toHaveBeenCalledOnce();
          expect(authoring.loweringCount()).toBe(1);

          const priorQueries = target.queryCount();
          const controller = new AbortController();
          controller.abort();
          await expect(
            prepared.query(target.runtime, {}, { signal: controller.signal }).toArray(),
          ).rejects.toThrow();
          expect(target.queryCount()).toBe(priorQueries);

          const firstDescription = authoring.first();
          const firstSql = await authoring.runtime.prepare({}, () => firstDescription);
          const first = createPreparedRowQuery(firstDescription, firstSql);
          expect(await first.query(authoring.runtime, {})).toBeNull();
          const connection = await target.runtime.connection();
          try {
            const transaction = await connection.transaction();
            try {
              await target.insert(transaction);
              expect(await first.query(transaction, {})).toEqual({
                name: 'Transaction',
                posts: [],
              });
              expect(await first.query(authoring.runtime, {})).toBeNull();
            } finally {
              await transaction.rollback();
            }
            expect(await first.query(connection, {})).toBeNull();
          } finally {
            await connection.release();
          }
          expect(authoring.loweringCount()).toBe(2);
        } finally {
          await target?.close();
          await authoring.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
}

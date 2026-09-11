import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import pgvector from '@internal/extension-pgvector/runtime';
import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import postgres from '@internal/postgres/runtime';
import type { PreparedRowQuery } from '@internal/sql-orm-client';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import type {
  PreparedExecution,
  PreparedStatement,
  Runtime,
  RuntimeQueryable,
} from '@internal/sql-runtime';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import sqlite from '@internal/sqlite/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { getTestContract } from './sql-orm-client/helpers';

const lowerings = vi.hoisted(() => ({ postgres: vi.fn(), sqlite: vi.fn() }));
vi.mock('@internal/adapter-postgres/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('@internal/adapter-postgres/runtime')>();
  return {
    ...original,
    default: {
      ...original.default,
      create: (...args: Parameters<typeof original.default.create>) => {
        const adapter = original.default.create(...args);
        return {
          ...adapter,
          lower: (...params: Parameters<typeof adapter.lower>) => {
            lowerings.postgres();
            return adapter.lower(...params);
          },
        };
      },
    },
  };
});
vi.mock('@internal/adapter-sqlite/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('@internal/adapter-sqlite/runtime')>();
  return {
    ...original,
    default: {
      ...original.default,
      create: (...args: Parameters<typeof original.default.create>) => {
        const adapter = original.default.create(...args);
        return {
          ...adapter,
          lower: (...params: Parameters<typeof adapter.lower>) => {
            lowerings.sqlite();
            return adapter.lower(...params);
          },
        };
      },
    },
  };
});

type Row = { id: number; name: string };
type NoParams = Record<never, never>;
interface Environment {
  runtime: Runtime;
  all(callback: () => void): Promise<PreparedRowQuery<NoParams, AsyncIterableResult<Row>>>;
  first(): Promise<PreparedRowQuery<NoParams, Promise<Row | null>>>;
  sql(callback: () => void): Promise<PreparedStatement<{ readonly id: number }, { id: number }>>;
  stats(): Promise<PreparedExecution<NoParams>>;
  shapedRows(): Promise<PreparedStatement<NoParams, { affectedRows: number }>>;
  insert(target: RuntimeQueryable): Promise<unknown>;
  close(): Promise<void>;
}

async function postgresEnvironment(name: string): Promise<Environment> {
  const database = await createDevDatabase({ databaseIdleTimeoutMillis: timeouts.spinUpPpgDev });
  const client = new Client({ connectionString: database.connectionString });
  await client.connect();
  await client.query(
    'create table users (id int4 primary key, name text, email text, invited_by_id int4, address jsonb)',
  );
  await client.query('insert into users (id, name) values (1, $1)', [name]);
  const db = postgres({
    contract: getTestContract(),
    pg: client,
    extensions: [pgvector],
    verifyMarker: false,
  });
  const runtime = await db.connect();
  return {
    runtime,
    all: (callback) =>
      db.prepare({}, () => {
        callback();
        return db.orm.public.User.select('id', 'name').prepared.all();
      }),
    first: () =>
      db.prepare({}, () => db.orm.public.User.select('id', 'name').prepared.first({ id: 2 })),
    sql: (callback) =>
      db.prepare({ id: 'pg/int4@1' }, (params) => {
        callback();
        return db.sql.public.users
          .select('id')
          .where((user, fns) => fns.eq(user.id, params.id))
          .build();
      }),
    stats: () =>
      db.prepare({}, () =>
        planFromAst<AffectedCount>(
          RawQueryAst.affectedCount(['update users set name = name']),
          db.contract,
        ),
      ),
    shapedRows: () =>
      db.prepare({}, () =>
        planFromAst<{ affectedRows: number }>(
          RawQueryAst.rows(['select 7 as "affectedRows"'], {
            affectedRows: { codecId: 'pg/int4@1', nullable: false },
          }),
          db.contract,
        ),
      ),
    insert: (target) =>
      target.execute(
        planFromAst(
          RawQueryAst.affectedCount(["insert into users (id, name) values (2, 'Transaction')"]),
          db.contract,
        ),
      ),
    async close() {
      await db.close();
      await client.end();
      await database.close();
    },
  };
}

const contract = defineContract({
  models: {
    User: model('User', {
      fields: { id: field.column(integerColumn).id(), name: field.column(textColumn) },
    }).sql({ table: 'users' }),
  },
});
async function sqliteEnvironment(name: string): Promise<Environment> {
  const directory = mkdtempSync(join(tmpdir(), 'prepared-facades-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec('create table users (id integer primary key, name text)');
  database.prepare('insert into users values (1, ?)').run(name);
  const db = sqlite({ contract, path, verifyMarker: false });
  const runtime = await db.connect();
  return {
    runtime,
    all: (callback) =>
      db.prepare({}, () => {
        callback();
        return db.orm.User.select('id', 'name').prepared.all();
      }),
    first: () => db.prepare({}, () => db.orm.User.select('id', 'name').prepared.first({ id: 2 })),
    sql: (callback) =>
      db.prepare({ id: 'sqlite/integer@1' }, (params) => {
        callback();
        return db.sql.users
          .select('id')
          .where((user, fns) => fns.eq(user.id, params.id))
          .build();
      }),
    stats: () =>
      db.prepare({}, () =>
        planFromAst<AffectedCount>(
          RawQueryAst.affectedCount(['update users set name = name']),
          db.contract,
        ),
      ),
    shapedRows: () =>
      db.prepare({}, () =>
        planFromAst<{ affectedRows: number }>(
          RawQueryAst.rows(['select 7 as affectedRows'], {
            affectedRows: { codecId: 'sqlite/integer@1', nullable: false },
          }),
          db.contract,
        ),
      ),
    insert: (target) =>
      target.execute(
        planFromAst(
          RawQueryAst.affectedCount(["insert into users (id, name) values (2, 'Transaction')"]),
          db.contract,
        ),
      ),
    async close() {
      await db.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const [name, setup] of [
  ['postgres', postgresEnvironment],
  ['sqlite', sqliteEnvironment],
] as const) {
  describe(`prepared facade on ${name}`, () => {
    it(
      'authors and lowers once, preserves full results and uses explicit targets/options',
      async () => {
        const authoring = await setup('Authoring');
        let target: Environment | undefined;
        try {
          target = await setup('Target');
          const callback = vi.fn();
          const authoringQuery = vi.spyOn(authoring.runtime, 'query');
          const before = lowerings[name].mock.calls.length;
          const prepared = await authoring.all(callback);
          expect(callback).toHaveBeenCalledOnce();
          expect(lowerings[name].mock.calls.length - before).toBe(1);
          expect(authoringQuery).not.toHaveBeenCalled();
          const result = prepared.query(target.runtime, {});
          expect(result[Symbol.asyncIterator]).toBeTypeOf('function');
          expect(await result).toEqual([{ id: 1, name: 'Target' }]);
          expect(await prepared.query(authoring.runtime, {})).toEqual([
            { id: 1, name: 'Authoring' },
          ]);
          const streamed: Row[] = [];
          for await (const row of prepared.query(target.runtime, {})) streamed.push(row);
          expect(streamed).toEqual([{ id: 1, name: 'Target' }]);
          expect(callback).toHaveBeenCalledOnce();
          expect(lowerings[name].mock.calls.length - before).toBe(1);
          const controller = new AbortController();
          controller.abort();
          await expect(
            prepared.query(target.runtime, {}, { signal: controller.signal }).toArray(),
          ).rejects.toThrow();
          const first = await authoring.first();
          expect(await first.query(target.runtime, {})).toBeNull();
          const connection = await target.runtime.connection();
          try {
            const tx = await connection.transaction();
            try {
              await target.insert(tx);
              expect(await first.query(tx, {})).toEqual({ id: 2, name: 'Transaction' });
              expect(await first.query(authoring.runtime, {})).toBeNull();
            } finally {
              await tx.rollback();
            }
          } finally {
            await connection.release();
          }
          const sqlCallback = vi.fn();
          const beforeSql = lowerings[name].mock.calls.length;
          const sql = await authoring.sql(sqlCallback);
          expect(await sql.query(target.runtime, { id: 1 })).toEqual([{ id: 1 }]);
          expect(await sql.query(target.runtime, { id: 99 })).toEqual([]);
          expect(sqlCallback).toHaveBeenCalledOnce();
          expect(lowerings[name].mock.calls.length - beforeSql).toBe(1);
          expect(await (await authoring.stats()).execute(target.runtime, {})).toEqual({
            affectedRows: 1,
          });
          expect(await (await authoring.shapedRows()).query(target.runtime, {})).toEqual([
            { affectedRows: 7 },
          ]);
        } finally {
          await target?.close();
          await authoring.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
}

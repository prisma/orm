import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import { soleDomainNamespaceId } from '@internal/contract/types';
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
import { defineContract, field, model, rel } from '@internal/sqlite/contract-builder';
import sqlite from '@internal/sqlite/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { Client } from 'pg';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Contract as AggregateContract } from './sql-orm-client/fixtures/integer-representation-sqlite/generated/contract';
import aggregateContractJson from './sql-orm-client/fixtures/integer-representation-sqlite/generated/contract.json' with {
  type: 'json',
};
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
type GroupParams = {
  readonly minimum: number;
  readonly excluded: number | null;
  readonly threshold: number;
  readonly pre: number;
  readonly take: number;
  readonly skip: number;
};
type GroupResult = Array<{ id: number; total: bigint }>;
interface Environment {
  grouped(
    selector: () => void,
    configure: () => void,
  ): Promise<PreparedRowQuery<GroupParams, Promise<GroupResult>>>;
  runtime: Runtime;
  aggregateRuntime: Runtime;
  bigCount(id: number): Promise<PreparedRowQuery<NoParams, Promise<{ total: bigint }>>>;
  insertAggregate(target: RuntimeQueryable): Promise<unknown>;
  aggregate(
    callback: () => void,
  ): Promise<
    PreparedRowQuery<
      { readonly id: number | null; readonly limit: number },
      Promise<{ min: number | null; avg: number | null }>
    >
  >;
  ordinaryAggregate(id: number, limit: number): Promise<{ min: number | null; avg: number | null }>;
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
    aggregateRuntime: runtime,
    grouped: async (selector, configure) => {
      const prepared = await db.prepare(
        {
          minimum: 'pg/int4@1',
          excluded: { codecId: 'pg/int4@1', nullable: true },
          threshold: 'pg/int8number@1',
          pre: 'pg/int4@1',
          take: 'pg/int4@1',
          skip: 'pg/int4@1',
        },
        (p) =>
          db.orm.public.User.where((user) => user.id.gte(p.minimum))
            .orderBy((user) => user.id.asc())
            .limit(p.pre)
            .groupBy('id')
            .having((h) => h.count().gte(p.threshold))
            .having((h) => h.min('id').neq(p.excluded))
            .orderBy((user) => user.id.asc())
            .limit(p.take)
            .offset(p.skip)
            .prepared.aggregate((agg) => {
              selector();
              return { total: agg.countBigInt() };
            }, configure),
      );
      expectTypeOf<ReturnType<typeof prepared.query>>().toEqualTypeOf<Promise<GroupResult>>();
      return prepared;
    },
    bigCount: (id) =>
      db.prepare({}, () =>
        db.orm.public.User.where({ id }).prepared.aggregate((agg) => ({
          total: agg.countBigInt(),
        })),
      ),
    insertAggregate: (target) =>
      target.execute(
        planFromAst(
          RawQueryAst.affectedCount(["insert into users (id, name) values (2, 'Transaction')"]),
          db.contract,
        ),
      ),
    aggregate: async (callback) => {
      const prepared = await db.prepare(
        { id: { codecId: 'pg/int4@1', nullable: true }, limit: 'pg/int4@1' },
        (p) =>
          db.orm.public.User.where((user) => user.id.eq(p.id))
            .orderBy((user) => user.id.asc())
            .limit(p.limit)
            .prepared.aggregate((agg) => {
              callback();
              return { min: agg.min('id'), avg: agg.avg('id') };
            }),
      );
      expectTypeOf<ReturnType<typeof prepared.query>>().toEqualTypeOf<
        Promise<{ min: number | null; avg: number | null }>
      >();
      return prepared;
    },
    ordinaryAggregate: (id, limit) =>
      db.orm.public.User.where((user) => user.id.eq(id))
        .orderBy((user) => user.id.asc())
        .limit(limit)
        .aggregate((agg) => ({ min: agg.min('id'), avg: agg.avg('id') })),
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
  database.exec(
    'create table users (id integer primary key, name text); create view int_repr_meters as select id, id as peak from users',
  );
  database.prepare('insert into users values (1, ?)').run(name);
  const db = sqlite({ contract, path, verifyMarker: false });
  const aggregateDb = sqlite<AggregateContract>({
    contractJson: aggregateContractJson,
    path,
    verifyMarker: false,
  });
  const runtime = await db.connect();
  return {
    runtime,
    aggregateRuntime: await aggregateDb.connect(),
    grouped: async (selector, configure) => {
      const prepared = await aggregateDb.prepare(
        {
          minimum: 'sqlite/integer@1',
          excluded: { codecId: 'sqlite/integer@1', nullable: true },
          threshold: 'sqlite/bigintnumber@1',
          pre: 'sqlite/integer@1',
          take: 'sqlite/integer@1',
          skip: 'sqlite/integer@1',
        },
        (p) =>
          aggregateDb.orm.Meter.where((meter) => meter.id.gte(p.minimum))
            .orderBy((meter) => meter.id.asc())
            .limit(p.pre)
            .groupBy('id')
            .having((h) => h.count().gte(p.threshold))
            .having((h) => h.min('id').neq(p.excluded))
            .orderBy((meter) => meter.id.asc())
            .limit(p.take)
            .offset(p.skip)
            .prepared.aggregate((agg) => {
              selector();
              return { total: agg.countBigInt() };
            }, configure),
      );
      expectTypeOf<ReturnType<typeof prepared.query>>().toEqualTypeOf<Promise<GroupResult>>();
      return prepared;
    },
    bigCount: (id) =>
      aggregateDb.prepare({}, () =>
        aggregateDb.orm.Meter.where({ id }).prepared.aggregate((agg) => ({
          total: agg.countBigInt(),
        })),
      ),
    insertAggregate: (target) =>
      target.execute(
        planFromAst(
          RawQueryAst.affectedCount(["insert into users (id, name) values (2, 'Transaction')"]),
          aggregateDb.contract,
        ),
      ),
    aggregate: async (callback) => {
      const prepared = await aggregateDb.prepare(
        { id: { codecId: 'sqlite/integer@1', nullable: true }, limit: 'sqlite/integer@1' },
        (p) =>
          aggregateDb.orm.Meter.where((meter) => meter.id.eq(p.id))
            .orderBy((user) => user.id.asc())
            .limit(p.limit)
            .prepared.aggregate((agg) => {
              callback();
              return { min: agg.min('id'), avg: agg.avg('id') };
            }),
      );
      expectTypeOf<ReturnType<typeof prepared.query>>().toEqualTypeOf<
        Promise<{ min: number | null; avg: number | null }>
      >();
      return prepared;
    },
    ordinaryAggregate: (id, limit) =>
      aggregateDb.orm.Meter.where((meter) => meter.id.eq(id))
        .orderBy((user) => user.id.asc())
        .limit(limit)
        .aggregate((agg) => ({ min: agg.min('id'), avg: agg.avg('id') })),
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
      await aggregateDb.close();
      await db.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

it('binds included columns inside the db.prepare callback and retains them across executions', async () => {
  const User = model('User', { fields: { id: field.column(integerColumn).id() } });
  const Post = model('Post', {
    fields: {
      id: field.column(integerColumn).id(),
      userId: field.column(integerColumn).column('user_id'),
    },
    relations: { author: rel.belongsTo(User, { from: 'userId', to: 'id' }) },
  });
  const contract = defineContract({
    models: { User: User.relations({ posts: rel.hasMany(() => Post, { by: 'userId' }) }), Post },
  });
  const directory = mkdtempSync(join(tmpdir(), 'prepared-include-bindings-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(
    'create table User (id integer primary key); create table Post (id integer primary key, user_id integer); insert into User values (1); insert into Post values (2, 1)',
  );
  const db = sqlite({ contract, path, verifyMarker: false });
  try {
    const runtime = await db.connect();
    const users = db.orm.User;
    const lookup = vi.spyOn(users.ctx.context.contractCodecs, 'forColumn');
    const prepared = await db.prepare({}, () => {
      const before = lookup.mock.calls.length;
      const query = users
        .select('id')
        .include('posts', (posts) => posts.select('userId'))
        .prepared.all();
      expect(lookup.mock.calls.length).toBeGreaterThan(before);
      expect(lookup).toHaveBeenCalledWith(
        soleDomainNamespaceId(contract.domain),
        'Post',
        'user_id',
      );
      return query;
    });
    const count = lookup.mock.calls.length;
    const first = await prepared.query(runtime, {});
    const second = await prepared.query(runtime, {});
    expect(first).toEqual([{ id: 1, posts: [{ userId: 1 }] }]);
    expect(second).toEqual(first);
    expect(second[0]?.posts).not.toBe(first[0]?.posts);
    expect(second[0]?.posts[0]).not.toBe(first[0]?.posts[0]);
    expect(lookup).toHaveBeenCalledTimes(count);
  } finally {
    await db.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [name, setup] of [
  ['postgres', postgresEnvironment],
  ['sqlite', sqliteEnvironment],
] as const) {
  describe(`prepared facade on ${name}`, () => {
    it(
      'prepares grouped HAVING and both pagination stages once for explicit execution scopes',
      async () => {
        const authoring = await setup('Authoring');
        let target: Environment | undefined;
        try {
          target = await setup('Target');
          const selector = vi.fn();
          const configure = vi.fn();
          const authorQuery = vi.spyOn(authoring.aggregateRuntime, 'query');
          const targetQuery = vi.spyOn(target.aggregateRuntime, 'query');
          const before = lowerings[name].mock.calls.length;
          const prepared = await authoring.grouped(selector, configure);
          expect(authorQuery).not.toHaveBeenCalled();
          expect(targetQuery).not.toHaveBeenCalled();
          expect(selector).toHaveBeenCalledOnce();
          expect(configure).toHaveBeenCalledOnce();
          expect(lowerings[name].mock.calls.length - before).toBe(1);
          const params = { minimum: 1, excluded: null, threshold: 1, pre: 10, take: 10, skip: 0 };
          const [a, b] = await Promise.all([
            prepared.query(target.aggregateRuntime, params),
            prepared.query(authoring.aggregateRuntime, { ...params, excluded: 1 }),
          ]);
          expect(a).toEqual([{ id: 1, total: 1n }]);
          expect(b).toEqual([]);
          expect(
            await prepared.query(target.aggregateRuntime, { ...params, threshold: 2 }),
          ).toEqual([]);
          const again = await prepared.query(target.aggregateRuntime, params);
          expect(again).toEqual(a);
          expect(again).not.toBe(a);
          expect(again[0]).not.toBe(a[0]);
          expect(selector).toHaveBeenCalledOnce();
          expect(configure).toHaveBeenCalledOnce();
          expect(lowerings[name].mock.calls.length - before).toBe(1);
          const connection = await target.aggregateRuntime.connection();
          try {
            const tx = await connection.transaction();
            try {
              await target.insertAggregate(tx);
              expect(await prepared.query(tx, { ...params, take: 1, skip: 1 })).toEqual([
                { id: 2, total: 1n },
              ]);
              expect(await prepared.query(tx, { ...params, pre: 1, take: 1, skip: 1 })).toEqual([]);
              expect(await prepared.query(tx, { ...params, minimum: 2 })).toEqual([
                { id: 2, total: 1n },
              ]);
              expect(
                await prepared.query(authoring.aggregateRuntime, { ...params, minimum: 2 }),
              ).toEqual([]);
            } finally {
              await tx.rollback();
            }
            expect(await prepared.query(connection, { ...params, minimum: 2 })).toEqual([]);
          } finally {
            await connection.release();
          }
          const controller = new AbortController();
          controller.abort();
          await expect(
            prepared.query(target.aggregateRuntime, params, { signal: controller.signal }),
          ).rejects.toThrow();
        } finally {
          await target?.close();
          await authoring.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'prepares aggregate objects once with ordinary parity, nullable filters, pagination and explicit transactions',
      async () => {
        const authoring = await setup('Authoring');
        let target: Environment | undefined;
        try {
          target = await setup('Target');
          const callback = vi.fn();
          const query = vi.spyOn(authoring.aggregateRuntime, 'query');
          const before = lowerings[name].mock.calls.length;
          const prepared = await authoring.aggregate(callback);
          expect(query).not.toHaveBeenCalled();
          expect(callback).toHaveBeenCalledOnce();
          expect(lowerings[name].mock.calls.length - before).toBe(1);
          const params = { id: 1, limit: 1 };
          const [a, b] = await Promise.all([
            prepared.query(target.aggregateRuntime, params),
            prepared.query(authoring.aggregateRuntime, { id: 99, limit: 1 }),
          ]);
          expect(a).toEqual({ min: 1, avg: 1 });
          expect(b).toEqual({ min: null, avg: null });
          expect(await prepared.query(target.aggregateRuntime, { id: null, limit: 1 })).toEqual({
            min: null,
            avg: null,
          });
          expect(await prepared.query(target.aggregateRuntime, { id: 1, limit: 0 })).toEqual({
            min: null,
            avg: null,
          });
          const again = await prepared.query(target.aggregateRuntime, params);
          expect(again).toEqual(a);
          expect(again).not.toBe(a);
          expect(callback).toHaveBeenCalledOnce();
          expect(lowerings[name].mock.calls.length - before).toBe(1);
          expect(await target.ordinaryAggregate(1, 1)).toEqual(a);
          expect(await target.ordinaryAggregate(99, 1)).toEqual(b);
          for (const [id, total] of [
            [1, 1n],
            [99, 0n],
          ] as const) {
            const bigCount = await authoring.bigCount(id);
            expectTypeOf<ReturnType<typeof bigCount.query>>().toEqualTypeOf<
              Promise<{ total: bigint }>
            >();
            const first = await bigCount.query(target.aggregateRuntime, {});
            const second = await bigCount.query(target.aggregateRuntime, {});
            expect(first).toEqual({ total });
            expect(second).toEqual(first);
            expect(second).not.toBe(first);
          }
          const connection = await target.aggregateRuntime.connection();
          try {
            const tx = await connection.transaction();
            try {
              await target.insertAggregate(tx);
              expect(await prepared.query(tx, { id: 2, limit: 1 })).toEqual({ min: 2, avg: 2 });
              expect(await prepared.query(authoring.aggregateRuntime, { id: 2, limit: 1 })).toEqual(
                b,
              );
            } finally {
              await tx.rollback();
            }
            expect(await prepared.query(connection, { id: 2, limit: 1 })).toEqual(b);
          } finally {
            await connection.release();
          }
          const controller = new AbortController();
          controller.abort();
          await expect(
            prepared.query(target.aggregateRuntime, params, { signal: controller.signal }),
          ).rejects.toThrow();
        } finally {
          await target?.close();
          await authoring.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
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

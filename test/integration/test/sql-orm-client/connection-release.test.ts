import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

const Parent = model('Parent', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
  },
}).sql({ table: 'parents' });
const Child = model('Child', {
  fields: {
    id: field.column(int4Column).id(),
    parentId: field.column(int4Column).column('parent_id'),
  },
  relations: { parent: rel.belongsTo(Parent, { from: 'parentId', to: 'id' }) },
}).sql({ table: 'children' });
const contract = defineContract({
  models: {
    Parent: Parent.relations({ children: rel.hasMany(() => Child, { by: 'parentId' }) }),
    Child,
  },
});

async function withPooledRuntime(
  run: (setup: Awaited<ReturnType<typeof createPooledRuntime>>) => Promise<void>,
): Promise<void> {
  const database = await createDevDatabase();
  const pool = new Pool({
    connectionString: database.connectionString,
    max: 1,
    connectionTimeoutMillis: timeouts.default,
  });
  let runtime: PostgresRuntimeImpl | undefined;
  try {
    const setup = await createPooledRuntime(pool);
    runtime = setup.runtime;
    await run(setup);
  } finally {
    try {
      if (runtime) await runtime.close();
      else await pool.end();
    } finally {
      await database.close();
    }
  }
}

async function createPooledRuntime(pool: Pool) {
  await pool.query(`
    create table parents (id integer primary key, name text not null);
    create table children (id integer primary key, parent_id integer not null);
    insert into parents values (1, 'Alice'), (2, 'Bob');
    insert into children values (10, 1), (20, 2);
  `);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: {
      ...postgresDriver,
      create: () => postgresDriver.create({ cursor: { disabled: true } }),
    },
    extensions: [],
  });
  const context = createExecutionContext({ contract, stack });
  const instance = instantiateExecutionStack(stack);
  if (!instance.adapter || !instance.driver) throw new Error('Missing adapter or driver');
  await instance.driver.connect({ kind: 'pgPool', pool });
  const runtime = new PostgresRuntimeImpl({
    context,
    adapter: instance.adapter,
    driver: instance.driver,
    verifyMarker: false,
  });
  const parents = new Collection({ runtime, context }, 'Parent', { namespaceId: 'public' });
  const included = parents
    .select('id', 'name')
    .orderBy((parent) => parent.id.asc())
    .include('children', (children) => children.select('id'));
  const codec = context.contractCodecs.forColumn('public', 'parents', 'name');
  if (!codec) throw new Error('Missing parent name codec');
  return { runtime, pool, parents, included, codec };
}

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const expected = [
  { id: 1, name: 'Alice', children: [{ id: 10 }] },
  { id: 2, name: 'Bob', children: [{ id: 20 }] },
];

describe('integration/ORM buffered connection release', () => {
  it(
    'makes the size-one pool available while an included parent is decoding',
    async () => {
      await withPooledRuntime(async ({ pool, parents, included, codec }) => {
        const entered = gate();
        const resume = gate();
        const decode = codec.decode.bind(codec);
        const spy = vi.spyOn(codec, 'decode').mockImplementationOnce(async (wire, context) => {
          entered.resolve();
          await resume.promise;
          return decode(wire, context);
        });
        const first = Promise.resolve(included.all());
        try {
          await Promise.race([
            entered.promise,
            first.then(() => {
              throw new Error('Query finished without entering the parent decoder');
            }),
          ]);
          expect(pool.totalCount).toBe(1);
          expect(pool.idleCount).toBe(1);
          await expect(
            parents
              .select('id')
              .orderBy((parent) => parent.id.asc())
              .all(),
          ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
          expect(pool.waitingCount).toBe(0);
        } finally {
          resume.resolve();
          try {
            await expect(first).resolves.toEqual(expected);
          } finally {
            spy.mockRestore();
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'makes the size-one pool available while the include consumer is paused',
    async () => {
      await withPooledRuntime(async ({ pool, parents, included }) => {
        const iterator = included.all()[Symbol.asyncIterator]();
        try {
          expect(await iterator.next()).toEqual({ done: false, value: expected[0] });
          expect(pool.totalCount).toBe(1);
          expect(pool.idleCount).toBe(1);
          await expect(
            parents
              .select('id')
              .orderBy((parent) => parent.id.asc())
              .all(),
          ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
          expect(await iterator.next()).toEqual({ done: false, value: expected[1] });
          expect((await iterator.next()).done).toBe(true);
        } finally {
          await iterator.return?.();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'leaves the pool reusable after an included parent decoder fails',
    async () => {
      await withPooledRuntime(async ({ pool, parents, included, codec }) => {
        const released = vi.fn();
        pool.on('release', released);
        const spy = vi.spyOn(codec, 'decode').mockRejectedValueOnce(new Error('Decoder failed'));
        try {
          await expect(included.all()).rejects.toThrow();
          expect(pool.idleCount).toBe(1);
          expect(released).toHaveBeenCalledTimes(1);
          await expect(
            parents
              .select('id')
              .orderBy((parent) => parent.id.asc())
              .all(),
          ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
          expect(released).toHaveBeenCalledTimes(2);
        } finally {
          pool.off('release', released);
          spy.mockRestore();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});

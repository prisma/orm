import { Collection } from '@internal/sql-orm-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

const recorded = vi.hoisted(() => ({
  statements: [] as Array<{ readonly connection: number; readonly text: string }>,
  connections: 0,
  beginFailure: undefined as Error | undefined,
  disposals: [] as unknown[],
}));

vi.mock('pg', () => {
  function recordingQuery(connection: number) {
    return vi.fn(async (request: string | { readonly text: string }) => {
      recorded.statements.push({
        connection,
        text: typeof request === 'string' ? request : request.text,
      });
      const text = typeof request === 'string' ? request : request.text;
      if (text.startsWith('BEGIN') && recorded.beginFailure) throw recorded.beginFailure;
      return { rows: [], rowCount: 0 };
    });
  }
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => ({
      query: recordingQuery(++recorded.connections),
      release: vi.fn((reason?: unknown) => recorded.disposals.push(reason)),
      on: vi.fn(),
      off: vi.fn(),
    }));
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = recordingQuery(++recorded.connections);
    end = vi.fn(async () => {
      recorded.disposals.push('client ended');
    });
    release = vi.fn();
  }
  return { Pool, Client };
});

import postgres, {
  type PostgresTransactionContext,
  type PostgresTransactionOptions,
} from '../src/exports/runtime';
import postgresServerless from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';

class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string) {
    return this.where({ title });
  }
}

const contract = contractFromJson<Contract>(fixtureContractJson);
const collections = { Post: PostCollection };
const url = 'postgres://localhost:5432/db';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const selectIds = 'SELECT "id" AS "id" FROM "public"."posts"';
const resetViews = 'UPDATE posts SET views = 0';
const selectById = 'SELECT "id" AS "id" FROM "public"."posts" WHERE "id" = $1';
const selectTitled =
  'SELECT "posts"."id" AS "id", "posts"."title" AS "title", "posts"."user_id" AS "user_id", "posts"."views" AS "views" FROM "public"."posts" WHERE "posts"."title" = $1';

async function useEveryMember(
  tx: PostgresTransactionContext<Contract, typeof collections>,
): Promise<void> {
  await tx.query(tx.sql.public.posts.select('id').build());
  await tx.execute(tx.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());
  const byId = await tx.prepare({ id: 'pg/int4@1' }, (params) =>
    tx.sql.public.posts
      .select('id')
      .where((f, fns) => fns.eq(f.id, params.id))
      .build(),
  );
  await byId.query(tx, { id: 1 });
  await tx.orm.public.Post.titled('Hello').all();
}

const everyStatementInTheTransaction = [
  'BEGIN',
  selectIds,
  resetViews,
  selectById,
  selectTitled,
  'COMMIT',
];

function onOneConnection(texts: readonly string[]) {
  const connection = recorded.statements[0]?.connection;
  return texts.map((text) => ({ connection, text }));
}

afterEach(() => {
  recorded.statements.length = 0;
  recorded.connections = 0;
  recorded.beginFailure = undefined;
  recorded.disposals.length = 0;
  vi.useRealTimers();
});

describe.each(['pooled', 'serverless'] as const)('%s transaction isolation', (transport) => {
  async function client(transactionOptions?: PostgresTransactionOptions) {
    const options = { contract, verifyMarker: false as const, collections, transactionOptions };
    return transport === 'pooled'
      ? postgres({ ...options, url })
      : postgresServerless(options).connect({ url });
  }

  it.each([
    [undefined, undefined, 'BEGIN'],
    [{}, {}, 'BEGIN'],
    [{ isolationLevel: undefined }, { isolationLevel: undefined }, 'BEGIN'],
    [{ isolationLevel: 'RepeatableRead' }, undefined, 'BEGIN ISOLATION LEVEL REPEATABLE READ'],
    [{ isolationLevel: 'RepeatableRead' }, {}, 'BEGIN ISOLATION LEVEL REPEATABLE READ'],
    [
      { isolationLevel: 'RepeatableRead' },
      { isolationLevel: undefined },
      'BEGIN ISOLATION LEVEL REPEATABLE READ',
    ],
    [
      { isolationLevel: 'RepeatableRead' },
      { isolationLevel: 'Serializable' },
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
    ],
    [undefined, { isolationLevel: 'ReadUncommitted' }, 'BEGIN ISOLATION LEVEL READ UNCOMMITTED'],
    [undefined, { isolationLevel: 'ReadCommitted' }, 'BEGIN ISOLATION LEVEL READ COMMITTED'],
  ] as const)('resolves global %j and local %j', async (global, local, begin) => {
    const db = await client(global);
    recorded.statements.length = 0;
    await db.transaction(useEveryMember, local);
    expect(recorded.statements).toEqual(
      onOneConnection([begin, selectIds, resetViews, selectById, selectTitled, 'COMMIT']),
    );
    recorded.statements.length = 0;
    const manual = await db.runtime().connection();
    await (await manual.transaction()).rollback();
    await manual.release();
    expect(recorded.statements).toEqual(onOneConnection(['BEGIN', 'ROLLBACK']));
    await db.close();
  });

  it.each([
    [{ isolationLevel: 'RepeatableRead', timeout: 10 }, undefined, true, 'REPEATABLE READ'],
    [
      { isolationLevel: 'RepeatableRead', timeout: 10 },
      { isolationLevel: 'Serializable', timeout: undefined },
      true,
      'SERIALIZABLE',
    ],
    [
      { isolationLevel: 'RepeatableRead', timeout: 10 },
      { timeout: null },
      false,
      'REPEATABLE READ',
    ],
    [{ isolationLevel: 'RepeatableRead', timeout: null }, { timeout: 1 }, true, 'REPEATABLE READ'],
  ] as const)(
    'resolves timeout independently: global %j local %j',
    async (global, local, expires, isolation) => {
      const db = await client(global);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const entered = deferred();
      const resume = deferred();
      recorded.statements.length = 0;
      const run = db.transaction(async () => {
        entered.resolve();
        await resume.promise;
        return 42;
      }, local);
      const outcome = expires
        ? expect(run).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' })
        : expect(run).resolves.toBe(42);
      await entered.promise;
      await vi.advanceTimersByTimeAsync(20);
      resume.resolve();
      await outcome;
      expect(recorded.statements).toEqual(
        onOneConnection([`BEGIN ISOLATION LEVEL ${isolation}`, expires ? 'ROLLBACK' : 'COMMIT']),
      );
      expect(recorded.disposals).toHaveLength(transport === 'pooled' ? 1 : 0);
      expect(vi.getTimerCount()).toBe(0);
      const manual = await db.runtime().connection();
      const tx = await manual.transaction();
      await vi.advanceTimersByTimeAsync(20);
      await tx.rollback();
      await manual.release();
      await db.close();
    },
  );

  it.each([1, 2147483647, null, undefined])('accepts a global timeout of %s', async (timeout) => {
    const db = await client({ timeout });
    await expect(db.transaction(async () => 42, { timeout: null })).resolves.toBe(42);
    await db.close();
  });

  it('destroys an uncertain failed isolation start without invoking the callback', async () => {
    const db = await client({ isolationLevel: 'Serializable', timeout: 10 });
    recorded.statements.length = 0;
    const failure = new Error('begin failed');
    recorded.beginFailure = failure;
    const callback = vi.fn(async () => undefined);
    await expect(db.transaction(callback)).rejects.toBe(failure);
    expect(callback).not.toHaveBeenCalled();
    expect(recorded.statements).toEqual(onOneConnection(['BEGIN ISOLATION LEVEL SERIALIZABLE']));
    expect(recorded.disposals).toHaveLength(1);
    if (transport === 'pooled') expect(recorded.disposals[0]).toBeInstanceOf(Error);
    else expect(recorded.disposals).toEqual(['client ended']);
    await db.close();
  });

  const invalid = [
    ...[0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2147483648].map(
      (timeout) => ({ timeout }),
    ),
    null,
    1,
    'Serializable',
    { isolationLevel: null },
    { isolationLevel: 1 },
    { isolationLevel: 'unknown' },
    { isolationLevel: 'Serializable; DROP TABLE posts' },
    { isolationLevel: 'Serializable', extra: true },
  ];

  it.each(invalid)('rejects invalid global options %j during construction', (value) => {
    const options = { contract, transactionOptions: value as PostgresTransactionOptions };
    expect(() =>
      transport === 'pooled' ? postgres({ ...options, url }) : postgresServerless(options),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ARGUMENT_INVALID',
        why: expect.any(String),
        fix: expect.any(String),
      }),
    );
    expect(recorded.connections).toBe(0);
  });

  it.each(invalid)(
    'rejects invalid local options %j before acquisition or callback',
    async (value) => {
      const db = await client();
      const acquire = vi.spyOn(db.runtime(), 'connection');
      const callback = vi.fn(async () => 42);
      recorded.statements.length = 0;
      await expect(
        db.transaction(callback, value as PostgresTransactionOptions),
      ).rejects.toMatchObject({
        code: 'RUNTIME.ARGUMENT_INVALID',
        why: expect.any(String),
        fix: expect.any(String),
      });
      expect(acquire).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(recorded.statements).toEqual([]);
      await db.close();
    },
  );
});

describe('a postgres transaction', () => {
  it('offers sql, raw, prepare and orm, and runs every statement inside the transaction', async () => {
    const db = postgres({ contract, url, verifyMarker: false, collections });

    await db.transaction(useEveryMember);
    await db.close();

    expect(recorded.statements).toEqual(onOneConnection(everyStatementInTheTransaction));
  });

  it("offers the client's toSql, sql and raw", async () => {
    const db = postgres({ contract, url, verifyMarker: false });

    const members = await db.transaction(async (tx) => ({
      toSql: tx.toSql,
      sql: tx.sql,
      raw: tx.raw,
    }));
    await db.close();

    expect(members.toSql).toBe(db.toSql);
    expect(members.sql).toBe(db.sql);
    expect(members.raw).toBe(db.raw);
  });

  it('runs a statement prepared on the client inside the transaction it is given', async () => {
    const db = postgres({ contract, url, verifyMarker: false });
    const byId = await db.prepare({ id: 'pg/int4@1' }, (params) =>
      db.sql.public.posts
        .select('id')
        .where((f, fns) => fns.eq(f.id, params.id))
        .build(),
    );

    await db.transaction(async (tx) => {
      await byId.query(tx, { id: 1 });
    });
    await db.close();

    expect(recorded.statements).toEqual(onOneConnection(['BEGIN', selectById, 'COMMIT']));
  });

  it('runs a prepared ORM read inside the transaction it is given', async () => {
    const db = postgres({ contract, url, verifyMarker: false });
    const ids = await db.prepare({}, () => db.orm.public.Post.select('id').prepared.all());

    await db.transaction(async (tx) => ids.query(tx, {}));
    await db.close();

    expect(recorded.statements).toEqual(
      onOneConnection(['BEGIN', 'SELECT "posts"."id" AS "id" FROM "public"."posts"', 'COMMIT']),
    );
  });

  it('refuses a prepared statement run on the transaction after it ends', async () => {
    const db = postgres({ contract, url, verifyMarker: false });
    const byId = await db.prepare({ id: 'pg/int4@1' }, (params) =>
      db.sql.public.posts
        .select('id')
        .where((f, fns) => fns.eq(f.id, params.id))
        .build(),
    );

    const ended = await db.transaction(async (tx) => tx);

    await expect(async () => byId.query(ended, { id: 1 })).rejects.toThrow(/transaction has ended/);
    await db.close();
  });
});

describe('a transaction on a serverless connection', () => {
  it('offers sql, raw, prepare and orm, and runs every statement inside the transaction', async () => {
    const serverless = postgresServerless({ contract, verifyMarker: false, collections });
    await using db = await serverless.connect({ url });
    recorded.statements.length = 0;

    await db.transaction(useEveryMember);

    expect(recorded.statements).toEqual(onOneConnection(everyStatementInTheTransaction));
  });
});

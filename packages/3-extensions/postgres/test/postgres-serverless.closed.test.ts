import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

const recorded = vi.hoisted(() => ({
  calls: [] as string[],
  statements: [] as string[],
  answerOnATimer: false,
  failNextQuery: undefined as Error | undefined,
}));

// Only mock the third-party pg boundary. Real drivers, adapters, and runtimes run over this fake
// client. `end` takes a macrotask, as the real socket does, so the scope's disposal is still
// waiting when an unawaited promise settles.
vi.mock('pg', () => {
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn(async (arg: unknown) => {
      recorded.calls.push('query');
      const failure = recorded.failNextQuery;
      if (failure !== undefined) {
        recorded.failNextQuery = undefined;
        throw failure;
      }
      const text = typeof arg === 'string' ? arg : String((arg as { text: unknown }).text);
      recorded.statements.push(text);
      if (recorded.answerOnATimer) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (text.startsWith('INSERT INTO "public"."posts"')) {
        return { rows: [{ id: 1, title: 'Hello', user_id: 1, views: 0 }], rowCount: 1 };
      }
      if (
        text.startsWith('INSERT INTO "public"."users"') ||
        text.includes('json_agg') ||
        (recorded.answerOnATimer &&
          text.startsWith('SELECT') &&
          text.includes('FROM "public"."users"'))
      ) {
        return {
          rows: [{ id: 1, email: 'ada@example.com', name: 'Ada', invited_by_id: null, posts: [] }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    end = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          recorded.calls.push('end');
          setTimeout(resolve, 0);
        }),
    );
  }

  return { Client, Pool: class {} };
});

import postgresServerless from '../src/runtime/postgres-serverless';

const fixtureContract = validateSqlContractFully<Contract>(fixtureContractJson);
const url = 'postgres://localhost:5432/db';

const runtimeClosedError = {
  code: 'DRIVER.NOT_CONNECTED',
  message: 'Runtime is closed',
  why: 'close() was called on this runtime, or on the client or connection that owns it. An await using scope calls close() when it ends.',
  fix: 'Await every query, transaction and prepared statement before close(). The usual cause is a query returned without await from an await using scope.',
};

const unhandledRejections: unknown[] = [];
const recordUnhandledRejection = (reason: unknown): void => {
  unhandledRejections.push(reason);
};

beforeEach(() => {
  recorded.calls.length = 0;
  recorded.statements.length = 0;
  recorded.answerOnATimer = false;
  recorded.failNextQuery = undefined;
  unhandledRejections.length = 0;
  process.on('unhandledRejection', recordUnhandledRejection);
});

afterEach(() => {
  process.off('unhandledRejection', recordUnhandledRejection);
});

type Connection = Awaited<ReturnType<ReturnType<typeof postgresServerless<Contract>>['connect']>>;
type UnawaitedReturn = [string, (db: Connection) => PromiseLike<unknown>];

function updatePlan(db: Connection) {
  return db.sql.public.users
    .update({ name: 'probe' })
    .where((f, fns) => fns.eq(f.id, 1))
    .build();
}

const lazyReturns: ReadonlyArray<UnawaitedReturn> = [
  ['db.orm.public.User.all()', (db) => db.orm.public.User.all()],
  [
    'db.runtime().query(plan)',
    (db) => db.runtime().query(db.sql.public.users.select('id').build()),
  ],
];

const startedReturns: ReadonlyArray<[...UnawaitedReturn, unknown]> = [
  ['db.orm.public.User.first()', (db) => db.orm.public.User.first(), null],
  ['db.runtime().execute(plan)', (db) => db.runtime().execute(updatePlan(db)), { affectedRows: 0 }],
  [
    'db.transaction(fn)',
    (db) => db.transaction(async (tx) => (await tx.orm.public.User.all()).length),
    0,
  ],
];

const variants: ReadonlyArray<[string, { verifyMarker: boolean; warm: boolean }]> = [
  ['the first query on the connection', { verifyMarker: true, warm: false }],
  ['verifyMarker: false', { verifyMarker: false, warm: false }],
  ['an earlier awaited query on the connection', { verifyMarker: true, warm: true }],
];

function settled(promise: PromiseLike<unknown>) {
  return promise.then(
    (value) => ({ resolved: value }),
    (reason: unknown) => ({ rejected: reason }),
  );
}

function expectOneEndAndNoQueryAfterIt(): void {
  expect(recorded.calls.filter((call) => call === 'end')).toHaveLength(1);
  expect(recorded.calls.slice(recorded.calls.indexOf('end'))).toEqual(['end']);
}

describe('a promise returned from an await using scope without await', () => {
  describe.each(variants)('with %s', (_variant, { verifyMarker, warm }) => {
    const serverless = postgresServerless<Contract>({
      contractJson: fixtureContract,
      ...(verifyMarker ? {} : { verifyMarker: false }),
    });

    async function returnWithoutAwait(run: (db: Connection) => PromiseLike<unknown>) {
      await using db = await serverless.connect({ url });
      if (warm) await db.orm.public.User.first();
      return run(db);
    }

    it.each(lazyReturns)(
      '%s starts when awaited, after the close, and rejects once with the runtime closed error',
      async (_name, run) => {
        const outcome = await settled(returnWithoutAwait(run));

        expect.soft(unhandledRejections).toEqual([]);
        expect.soft(outcome).toEqual({ rejected: expect.objectContaining(runtimeClosedError) });
        expectOneEndAndNoQueryAfterIt();
      },
    );

    it.each(startedReturns)(
      '%s has started, so the close waits for it and it resolves',
      async (_name, run, value) => {
        const outcome = await settled(returnWithoutAwait(run));

        expect.soft(unhandledRejections).toEqual([]);
        expect.soft(outcome).toEqual({ resolved: value });
        expect(recorded.calls.indexOf('query')).toBeGreaterThanOrEqual(0);
        expect(recorded.calls.indexOf('query')).toBeLessThan(recorded.calls.indexOf('end'));
        expectOneEndAndNoQueryAfterIt();
      },
    );
  });
});

describe('two connections from two serverless clients', () => {
  it('stream.orm.public.User.first() returned without await from the inner scope resolves', async () => {
    const serverless = postgresServerless<Contract>({ contractJson: fixtureContract });
    const streaming = postgresServerless<Contract>({
      contractJson: fixtureContract,
      cursor: { batchSize: 10 },
    });

    async function returnWithoutAwait() {
      await using db = await serverless.connect({ url });
      await using stream = await streaming.connect({ url });
      void db;
      return stream.orm.public.User.first();
    }

    const outcome = await settled(returnWithoutAwait());

    expect.soft(unhandledRejections).toEqual([]);
    expect(outcome).toEqual({ resolved: null });
    expect(recorded.calls.filter((call) => call === 'end')).toHaveLength(2);
  });
});

describe('an unawaited started query that fails for its own reason', () => {
  it('is an ordinary unawaited failure: the caller gets its error, and Node reports it as unhandled while the close is pending', async () => {
    const serverless = postgresServerless<Contract>({
      contractJson: fixtureContract,
      verifyMarker: false,
    });
    const failure = new Error('simulated statement failure');

    async function returnWithoutAwait() {
      await using db = await serverless.connect({ url });
      recorded.failNextQuery = failure;
      return db.runtime().execute(updatePlan(db));
    }

    const outcome = await settled(returnWithoutAwait());

    const failed = expect.objectContaining({
      message: expect.stringContaining(failure.message),
    });
    expect(outcome).toEqual({ rejected: failed });
    expect(unhandledRejections).toEqual([failed]);
    expectOneEndAndNoQueryAfterIt();
  });
});

const ada = { email: 'ada@example.com', name: 'Ada' };
const adaRow = { id: 1, email: 'ada@example.com', name: 'Ada', invitedById: null };

async function countUsers(db: Connection): Promise<number> {
  return (await db.orm.public.User.all()).length;
}

const busyChainReturns: ReadonlyArray<[...UnawaitedReturn, unknown]> = [
  ['an async helper that awaits a lazy read', (db) => countUsers(db), 1],
  [
    'Promise.all over two lazy reads',
    (db) => Promise.all([db.orm.public.User.all(), db.orm.public.Post.all()]),
    [[adaRow], []],
  ],
  ['db.orm.public.User.create(data)', (db) => db.orm.public.User.create(ada), adaRow],
  [
    "db.orm.public.User.include('posts').create(data)",
    (db) => db.orm.public.User.include('posts').create(ada),
    { ...adaRow, posts: [] },
  ],
  [
    'a nested create',
    (db) =>
      db.orm.public.User.create({
        ...ada,
        posts: (post) => post.create([{ id: 1, title: 'Hello', views: 0 }]),
      }),
    adaRow,
  ],
  [
    'a helper that awaits a create and then returns a transaction',
    async (db) => {
      await db.orm.public.User.create(ada);
      return db.transaction(async (tx) => (await tx.orm.public.User.all()).length);
    },
    1,
  ],
];

// The database answers on a later turn of the event loop, as a real socket does, so each query of a chain starts after the previous one has answered.
describe('a promise returned without await, with a database that answers on a later turn of the event loop', () => {
  const serverless = postgresServerless<Contract>({ contractJson: fixtureContract });

  async function returnWithoutAwait(run: (db: Connection) => PromiseLike<unknown>) {
    await using db = await serverless.connect({ url });
    recorded.answerOnATimer = true;
    return run(db);
  }

  it.each(busyChainReturns)(
    '%s keeps the runtime busy from the close onward, so the close waits for it and it resolves',
    async (_name, run, value) => {
      const outcome = await settled(returnWithoutAwait(run));

      expect.soft(unhandledRejections).toEqual([]);
      expect.soft(outcome).toEqual({ resolved: value });
      expectOneEndAndNoQueryAfterIt();
    },
  );

  it('a helper that waits on a timer before its query starts after the runtime was idle for a turn of the event loop, and is refused', async () => {
    const outcome = await settled(
      returnWithoutAwait(async (db) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return countUsers(db);
      }),
    );

    expect(outcome).toEqual({ rejected: expect.objectContaining(runtimeClosedError) });
    expectOneEndAndNoQueryAfterIt();
  });

  it('a helper that calls db.runtime() after the scope has ended throws "Postgres connection is closed" at that call, as an ordinary unawaited failure', async () => {
    const outcome = await settled(
      returnWithoutAwait(async (db) => {
        await db.orm.public.User.first();
        return (await db.runtime().query(db.sql.public.users.select('id').build()).toArray())
          .length;
      }),
    );

    const connectionClosed = expect.objectContaining({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Postgres connection is closed',
    });
    expect(outcome).toEqual({ rejected: connectionClosed });
    expect(unhandledRejections).toEqual([connectionClosed]);
    expectOneEndAndNoQueryAfterIt();
  });
});

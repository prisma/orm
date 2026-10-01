import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { createContract } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

// Only mock the third-party pg boundary. Real drivers, adapters, and runtimes
// run over this fake pool/client.
vi.mock('pg', () => {
  const poolEndSpy = vi.fn().mockResolvedValue(undefined);
  const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const releaseSpy = vi.fn();

  const connectSpy = vi.fn().mockResolvedValue({
    query: querySpy,
    release: releaseSpy,
  });

  class Pool {
    on = vi.fn().mockReturnThis();
    static readonly _endSpy = poolEndSpy;
    static readonly _connectSpy = connectSpy;
    readonly _options: unknown;

    constructor(options: unknown) {
      this._options = options;
    }

    connect = connectSpy;
    end = poolEndSpy;
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }

  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
    release = vi.fn();
    escapeIdentifier = vi.fn();
    escapeLiteral = vi.fn();
  }

  return { Pool, Client };
});

import { Client, Pool } from 'pg';
import postgres from '../src/runtime/postgres';

const contract = createContract<SqlStorage>();
const fixtureContract = validateSqlContractFully<Contract>(fixtureContractJson);

const runtimeClosedError = {
  code: 'DRIVER.NOT_CONNECTED',
  message: 'Runtime is closed',
};

function poolEndSpy() {
  return (Pool as unknown as { _endSpy: ReturnType<typeof vi.fn> })._endSpy;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolEndSpy().mockResolvedValue(undefined);
  (Pool as unknown as { _connectSpy: ReturnType<typeof vi.fn> })._connectSpy.mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
    on: vi.fn(),
  });
});

describe('postgres close()', () => {
  it('releases the facade-owned Pool when constructed from { url }', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();
    await Promise.resolve();

    await db.close();

    expect(poolEndSpy()).toHaveBeenCalledTimes(1);
  });

  it('does NOT close a caller-supplied pg.Pool', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const ownEndSpy = vi.fn().mockResolvedValue(undefined);
    (pool as unknown as { end: typeof vi.fn }).end = ownEndSpy;

    const db = postgres({ contract, pg: pool });
    db.runtime();
    await db.close();

    expect(ownEndSpy).not.toHaveBeenCalled();
  });

  it('does NOT close a caller-supplied pg.Client', async () => {
    const client = new Client();
    const db = postgres({ contract, pg: client });
    db.runtime();
    await db.close();

    expect(client.end).not.toHaveBeenCalled();
  });

  it('is idempotent: calling twice does not throw and does not double-dispose the owned pool', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();
    await Promise.resolve();

    await db.close();
    await db.close();

    expect(poolEndSpy()).toHaveBeenCalledTimes(1);
  });

  it('returns the same promise from every call, so a failed pool.end() is reported to both callers and not retried', async () => {
    poolEndSpy().mockRejectedValueOnce(new Error('pool.end failed')).mockResolvedValue(undefined);

    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();
    await Promise.resolve();
    await Promise.resolve();

    const first = db.close();
    const second = db.close();

    expect(second).toBe(first);
    await expect(first).rejects.toThrow('pool.end failed');
    await expect(db.close()).rejects.toThrow('pool.end failed');
    expect(poolEndSpy()).toHaveBeenCalledTimes(1);
  });

  it('two concurrent calls both settle after pool.end() has settled', async () => {
    const order: string[] = [];
    let finishEnd: () => void = () => {};
    poolEndSpy().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishEnd = () => {
            order.push('pool ended');
            resolve();
          };
        }),
    );
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    db.runtime();
    await Promise.resolve();
    await Promise.resolve();

    const first = db.close().then(() => order.push('first close'));
    const second = db.close().then(() => order.push('second close'));
    await expect.poll(() => poolEndSpy().mock.calls.length).toBe(1);
    finishEnd();
    await Promise.all([first, second]);

    expect(order).toEqual(['pool ended', 'first close', 'second close']);
  });

  it('with a caller-supplied pg.Pool, ends nothing and leaves the runtime open', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const ownEndSpy = vi.fn().mockResolvedValue(undefined);
    (pool as unknown as { end: typeof vi.fn }).end = ownEndSpy;
    const db = postgres<Contract>({ contractJson: fixtureContract, pg: pool, verifyMarker: false });
    const runtime = db.runtime();

    await db.close();

    await expect(
      runtime.execute(
        db.sql.public.users
          .update({ name: 'probe' })
          .where((f, fns) => fns.eq(f.id, 1))
          .build(),
      ),
    ).resolves.toEqual({ affectedRows: 0 });
    expect(ownEndSpy).not.toHaveBeenCalled();
  });

  it('before any connect is a no-op', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    expect(poolEndSpy()).not.toHaveBeenCalled();
  });

  it('db.runtime() rejects with "Postgres client is closed" after close()', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    expect(() => db.runtime()).toThrow('Postgres client is closed');
  });

  it('db.connect() rejects with "Postgres client is closed" after close()', async () => {
    const db = postgres({ contract, url: 'postgres://localhost:5432/db' });
    await db.close();
    await expect(db.connect()).rejects.toThrow('Postgres client is closed');
  });

  it('await using db executes [Symbol.asyncDispose] on scope exit (pool.end called)', async () => {
    async function run() {
      await using db = postgres({ contract, url: 'postgres://localhost:5432/db' });
      db.runtime();
      await Promise.resolve();
    }

    await run();
    expect(poolEndSpy()).toHaveBeenCalledTimes(1);
  });
});

describe('a promise pending when close() is called on a client that owns its pool', () => {
  const unhandledRejections: unknown[] = [];
  const recordUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  const calls: string[] = [];
  const statements: string[] = [];
  let queryGate: Promise<void> | undefined;

  beforeEach(() => {
    unhandledRejections.length = 0;
    calls.length = 0;
    statements.length = 0;
    queryGate = undefined;
    process.on('unhandledRejection', recordUnhandledRejection);
    // Each statement is answered on a later turn of the event loop, as a real socket does. Like pg-pool, end() waits for every checked-out client to be released, then settles on a
    // later macrotask, as the real socket close does.
    let checkedOut = 0;
    let wakeEnd: (() => void) | undefined;
    poolEndSpy().mockImplementation(async () => {
      while (checkedOut > 0) {
        await new Promise<void>((wake) => {
          wakeEnd = wake;
        });
      }
      calls.push('end');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    (Pool as unknown as { _connectSpy: ReturnType<typeof vi.fn> })._connectSpy.mockImplementation(
      async () => {
        checkedOut += 1;
        return {
          query: vi.fn(async (arg: unknown) => {
            calls.push('query');
            await new Promise((resolve) => setTimeout(resolve, 0));
            await queryGate;
            const text = typeof arg === 'string' ? arg : String((arg as { text: unknown }).text);
            statements.push(text);
            const ada = { id: 1, email: 'ada@example.com', name: 'Ada', invited_by_id: null };
            if (text.startsWith('INSERT INTO "public"."users"')) return { rows: [ada] };
            if (text.includes('json_agg')) return { rows: [{ ...ada, posts: [] }] };
            if (text.startsWith('INSERT INTO "public"."posts"')) {
              return { rows: [{ id: 1, title: 'Hello', user_id: 1, views: 0 }] };
            }
            if (
              text.startsWith('SELECT') &&
              text.includes('FROM "public"."users"') &&
              text.includes('WHERE')
            ) {
              return { rows: [ada] };
            }
            return { rows: [], rowCount: 0 };
          }),
          release: vi.fn(() => {
            checkedOut -= 1;
            wakeEnd?.();
          }),
          on: vi.fn(),
        };
      },
    );
  });

  afterEach(() => {
    process.off('unhandledRejection', recordUnhandledRejection);
  });

  async function connectedClient() {
    const db = postgres<Contract>({
      contractJson: fixtureContract,
      url: 'postgres://localhost:5432/db',
    });
    await db.connect();
    return db;
  }

  async function closeWhilePending(
    db: Awaited<ReturnType<typeof connectedClient>>,
    pending: PromiseLike<unknown>,
    expectedUnhandledRejections: readonly unknown[] = [],
  ) {
    await db.close();
    const outcome = await pending.then(
      (value) => ({ resolved: value }),
      (reason: unknown) => ({ rejected: reason }),
    );
    expect.soft(unhandledRejections).toEqual(expectedUnhandledRejections);
    expect(poolEndSpy()).toHaveBeenCalledTimes(1);
    expect(calls.slice(calls.indexOf('end'))).toEqual(['end']);
    return outcome;
  }

  it('an ORM all() starts when awaited, after the close, and rejects with the runtime closed error', async () => {
    const db = await connectedClient();

    const outcome = await closeWhilePending(db, db.orm.public.User.all());

    expect(outcome).toEqual({ rejected: expect.objectContaining(runtimeClosedError) });
  });

  it('an ORM first() has started, so the close waits for it and it resolves', async () => {
    const db = await connectedClient();

    const outcome = await closeWhilePending(db, db.orm.public.User.first());

    expect(outcome).toEqual({ resolved: null });
    expect(calls.indexOf('query')).toBeLessThan(calls.indexOf('end'));
  });

  it('a transaction has started, so the close waits for it and it commits', async () => {
    const db = await connectedClient();

    const outcome = await closeWhilePending(
      db,
      db.transaction(async (tx) => (await tx.orm.public.User.all()).length),
    );

    expect(outcome).toEqual({ resolved: 0 });
    expect(calls.indexOf('query')).toBeLessThan(calls.indexOf('end'));
  });

  it('an execute has started, so the close waits for it and it resolves', async () => {
    const db = await connectedClient();

    const outcome = await closeWhilePending(
      db,
      db.runtime().execute(
        db.sql.public.users
          .update({ name: 'probe' })
          .where((f, fns) => fns.eq(f.id, 1))
          .build(),
      ),
    );

    expect(outcome).toEqual({ resolved: { affectedRows: 0 } });
    expect(calls.indexOf('query')).toBeLessThan(calls.indexOf('end'));
  });

  it('an ORM create() left pending at close() starts its insert after the close, so the runtime refuses it and it must be awaited first', async () => {
    const db = await connectedClient();

    const outcome = await closeWhilePending(
      db,
      db.orm.public.User.create({ email: 'ada@example.com', name: 'Ada' }),
      [expect.objectContaining(runtimeClosedError)],
    );

    expect(outcome).toEqual({ rejected: expect.objectContaining(runtimeClosedError) });
    expect(statements.some((text) => text.startsWith('INSERT'))).toBe(false);
  });

  it.each([
    [
      "include('posts').create()",
      (db: Awaited<ReturnType<typeof connectedClient>>) =>
        db.orm.public.User.include('posts').create({ email: 'ada@example.com', name: 'Ada' }),
    ],
    [
      'nested create',
      (db: Awaited<ReturnType<typeof connectedClient>>) =>
        db.orm.public.User.create({
          email: 'ada@example.com',
          name: 'Ada',
          posts: (post) => post.create([{ id: 1, title: 'Hello', views: 0 }]),
        }),
    ],
  ])(
    'an ORM %s left pending at close() is refused with "Postgres client is closed", so it must be awaited first',
    async (_name, run) => {
      const db = await connectedClient();

      const outcome = await closeWhilePending(db, run(db), [
        expect.objectContaining({ message: 'Postgres client is closed' }),
      ]);

      expect(outcome).toEqual({
        rejected: expect.objectContaining({
          code: 'DRIVER.NOT_CONNECTED',
          message: 'Postgres client is closed',
        }),
      });
    },
  );

  it("an ORM include('posts').create() awaited before close() completes", async () => {
    const db = await connectedClient();

    const created = await db.orm.public.User.include('posts').create({
      email: 'ada@example.com',
      name: 'Ada',
    });
    await db.close();

    expect(created).toEqual({
      id: 1,
      email: 'ada@example.com',
      name: 'Ada',
      invitedById: null,
      posts: [],
    });
  });

  it('refuses an unrelated ORM call made after close() at once, while the close waits only for the query already in flight', async () => {
    const db = await connectedClient();
    let openGate: () => void = () => {};
    queryGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const inFlight = db.orm.public.User.first();
    await expect.poll(() => calls.includes('query')).toBe(true);
    let closed = false;
    const closing = db.close().then(() => {
      closed = true;
    });

    await expect(db.orm.public.User.first()).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Postgres client is closed',
    });
    expect(closed).toBe(false);
    openGate();
    await expect(inFlight).resolves.toBeNull();
    await closing;
    expect(closed).toBe(true);
  });

  it('refuses a query through a runtime captured before close() at once, while the close waits only for the query already in flight', async () => {
    const db = await connectedClient();
    const runtime = db.runtime();
    const plan = db.sql.public.users.select('id').build();
    let openGate: () => void = () => {};
    queryGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const inFlight = runtime.query(plan).toArray();
    await expect.poll(() => calls.includes('query')).toBe(true);
    let closed = false;
    const closing = db.close().then(() => {
      closed = true;
    });

    await expect(runtime.query(plan).toArray()).rejects.toMatchObject(runtimeClosedError);
    await expect(runtime.query(plan).toArray()).rejects.toMatchObject(runtimeClosedError);
    expect(closed).toBe(false);
    openGate();
    await expect(inFlight).resolves.toEqual([]);
    await closing;
    expect(closed).toBe(true);
  });

  it('close() closes the runtime in the same call, so a lazy read awaited a turn of the event loop later is refused, as on a connection', async () => {
    const db = await connectedClient();
    const runtimeClose = vi.spyOn(db.runtime(), 'close');
    const pending = db.orm.public.User.all();

    const closing = db.close();
    expect(runtimeClose).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const outcome = await pending.then(
      (value) => ({ resolved: value }),
      (reason: unknown) => ({ rejected: reason }),
    );
    await closing;

    expect(outcome).toEqual({ rejected: expect.objectContaining(runtimeClosedError) });
    expect.soft(unhandledRejections).toEqual([]);
  });
});

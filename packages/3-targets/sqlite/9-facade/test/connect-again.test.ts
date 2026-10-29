import type { Contract } from '@internal/contract/types';
import { coreHash } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { SqlStorage } from '@internal/sql-contract/types';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { createContract } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sqlite from '../src/runtime/sqlite';

const contract: Contract<SqlStorage> = createContract<SqlStorage>({
  target: 'sqlite',
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-connect-again'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
});

const closed = { code: 'DRIVER.NOT_CONNECTED', message: 'SQLite client is closed' };
const alreadyBound = { code: 'DRIVER.ALREADY_CONNECTED' };

const rowsPlan = () => planFromAst(RawQueryAst.rows(['select 1 as one'], {}), contract);

function client() {
  return sqlite({ contract, path: ':memory:' });
}

function query(db: ReturnType<typeof client>) {
  return db.query(rowsPlan()).toArray();
}

function startQueryIgnoringItsResult(db: ReturnType<typeof client>): void {
  void query(db).catch(() => undefined);
}

async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  const winner = await Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise((resolve) => setTimeout(resolve, 0, marker)),
  ]);
  return winner === marker;
}

function driverConnectCalls() {
  const calls = { count: 0 };
  const createDriver = sqliteDriver.create.bind(sqliteDriver);
  vi.spyOn(sqliteDriver, 'create').mockImplementationOnce((options) => {
    const driver = createDriver(options);
    const connect = driver.connect.bind(driver);
    vi.spyOn(driver, 'connect').mockImplementation((binding) => {
      calls.count += 1;
      return connect(binding);
    });
    return driver;
  });
  return calls;
}

function driverConnectsWhenReleased() {
  let release: (outcome: { readonly error?: Error }) => void = () => undefined;
  const settled = new Promise<{ readonly error?: Error }>((resolve) => {
    release = resolve;
  });
  const createDriver = sqliteDriver.create.bind(sqliteDriver);
  vi.spyOn(sqliteDriver, 'create').mockImplementationOnce((options) => {
    const driver = createDriver(options);
    const connect = driver.connect.bind(driver);
    vi.spyOn(driver, 'connect').mockImplementationOnce(async (binding) => {
      const { error } = await settled;
      if (error !== undefined) throw error;
      return connect(binding);
    });
    return driver;
  });
  return release;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('connect() on a sqlite() client that is not connected', () => {
  it('binds the client to options and connects it', async () => {
    const db = sqlite({ contract });

    await expect(db.connect({ path: ':memory:' })).resolves.toBe(db.runtime());
    await db.close();
  });
});

describe('connect() on a sqlite() client that is connecting', () => {
  it('waits for a connection connect() started, then resolves with the same runtime', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    const first = db.connect();
    const second = db.connect();

    expect(await stillPending(second)).toBe(true);
    release({});
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a).toBe(db.runtime());
    await db.close();
  });

  it('waits for a connection a query started, then resolves with the runtime', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    startQueryIgnoringItsResult(db);
    const connected = db.connect();

    expect(await stillPending(connected)).toBe(true);
    release({});
    await expect(connected).resolves.toBe(db.runtime());
    await db.close();
  });

  it('rejects with the error of a connection connect() started', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    const first = db.connect();
    const second = db.connect();
    release({ error: new Error('connect failed') });

    await expect(first).rejects.toThrow('connect failed');
    await expect(second).rejects.toThrow('connect failed');
  });

  it('rejects with the error of a connection a query started, and a later connect() tries again', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    startQueryIgnoringItsResult(db);
    const connected = db.connect();
    release({ error: new Error('connect failed') });

    await expect(connected).rejects.toThrow('connect failed');
    await expect(db.connect()).resolves.toBe(db.runtime());
    await db.close();
  });

  it('rejects options with DRIVER.ALREADY_CONNECTED', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    const first = db.connect();

    await expect(db.connect({ path: ':memory:' })).rejects.toMatchObject(alreadyBound);
    release({});
    await first;
    await db.close();
  });

  it('rejects every waiting call with DRIVER.NOT_CONNECTED when close() runs first', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    const first = db.connect();
    const second = db.connect();
    const closing = db.close();
    release({});

    await expect(first).rejects.toMatchObject(closed);
    await expect(second).rejects.toMatchObject(closed);
    await closing;
  });
});

describe('connect() on a sqlite() client that is connected', () => {
  it('resolves with the runtime after a query connected the client', async () => {
    const connectCalls = driverConnectCalls();
    const db = client();
    await expect(query(db)).resolves.toHaveLength(1);

    await expect(db.connect()).resolves.toBe(db.runtime());
    expect(connectCalls.count).toBe(1);
    await db.close();
  });

  it('resolves with the same runtime when called twice', async () => {
    const db = client();
    const first = await db.connect();

    await expect(db.connect()).resolves.toBe(first);
    await db.close();
  });

  it('treats connect(undefined) as connect()', async () => {
    const db = client();
    const first = await db.connect();

    await expect(db.connect(undefined)).resolves.toBe(first);
    await db.close();
  });

  it('rejects options with DRIVER.ALREADY_CONNECTED', async () => {
    const db = client();
    await db.connect();

    await expect(db.connect({ path: ':memory:' })).rejects.toMatchObject({
      code: 'DRIVER.ALREADY_CONNECTED',
      message: 'SQLite client is already bound',
      why: 'connect() was given options after the client was bound to a database.',
      fix: 'Call connect() without options, or create a new client for another database.',
      meta: { extension: 'sqlite' },
    });
    await db.close();
  });
});

describe('connect() on a closed sqlite() client', () => {
  it('rejects with DRIVER.NOT_CONNECTED', async () => {
    const db = client();
    await db.connect();
    await db.close();

    await expect(db.connect()).rejects.toMatchObject(closed);
  });

  it('rejects options with DRIVER.NOT_CONNECTED', async () => {
    const db = client();
    await db.close();

    await expect(db.connect({ path: ':memory:' })).rejects.toMatchObject(closed);
  });
});

import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type * as MongoRuntime from '@internal/mongo-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type AnyMongoContract = MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>;

const mocks = vi.hoisted(() => ({
  createMongoExecutionStack: vi.fn(),
  createMongoExecutionContext: vi.fn(),
  createMongoRuntime: vi.fn(),
  driverFromConnection: vi.fn(),
  driverFromDb: vi.fn(),
  deserializeContract: vi.fn(),
  mongoOrm: vi.fn(),
  mongoRaw: vi.fn(),
  mongoQuery: vi.fn(),
}));

vi.mock('@internal/adapter-mongo/runtime', () => ({ default: { id: 'adapter' } }));
vi.mock('@internal/target-mongo/runtime', () => ({ default: { id: 'target' } }));
vi.mock('@internal/mongo-runtime', async (importOriginal) => ({
  enumMemberCodecFor: (await importOriginal<typeof MongoRuntime>()).enumMemberCodecFor,
  createMongoExecutionStack: mocks.createMongoExecutionStack,
  createMongoExecutionContext: mocks.createMongoExecutionContext,
  createMongoRuntime: mocks.createMongoRuntime,
}));
vi.mock('@internal/driver-mongo', () => ({
  MongoDriverImpl: {
    fromConnection: mocks.driverFromConnection,
    fromDb: mocks.driverFromDb,
  },
}));
vi.mock('@internal/family-mongo/ir', () => ({
  MongoContractSerializer: class {
    deserializeContract(json: unknown) {
      return mocks.deserializeContract(json);
    }
  },
}));
vi.mock('@internal/mongo-orm', () => ({
  mongoOrm: mocks.mongoOrm,
  mongoRaw: mocks.mongoRaw,
}));
vi.mock('@internal/mongo-query-builder', () => ({ mongoQuery: mocks.mongoQuery }));

import mongo from '../src/runtime/mongo';

const fakeContract = {
  roots: {},
  models: {},
  domain: { namespaces: { [UNBOUND_NAMESPACE_ID]: { models: {} } } },
} as unknown as AnyMongoContract;
const url = 'mongodb://localhost:27017/mydb';
const fakeRuntime = { execute: vi.fn().mockResolvedValue({ affectedCount: 0 }) };
const closed = { code: 'DRIVER.NOT_CONNECTED', message: 'Mongo client is closed' };
const alreadyBound = { code: 'DRIVER.ALREADY_CONNECTED' };

function client() {
  return mongo({ contract: fakeContract, url });
}

function query(): Promise<unknown> {
  const runtime: { execute(plan: unknown): Promise<unknown> } =
    mocks.mongoOrm.mock.calls.at(-1)?.[0].runtime;
  return runtime.execute({});
}

function startQueryIgnoringItsResult(): void {
  void query().catch(() => undefined);
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

function driverConnectsWhenReleased() {
  let release: (outcome: { readonly error?: Error }) => void = () => undefined;
  const settled = new Promise<{ readonly error?: Error }>((resolve) => {
    release = resolve;
  });
  mocks.driverFromConnection.mockImplementationOnce(async () => {
    const { error } = await settled;
    if (error !== undefined) throw error;
    return { close: vi.fn().mockResolvedValue(undefined) };
  });
  return release;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.deserializeContract.mockReturnValue(fakeContract);
  mocks.createMongoExecutionStack.mockReturnValue({ adapter: { create: () => ({}) } });
  mocks.createMongoExecutionContext.mockReturnValue({
    contract: fakeContract,
    codecs: { get: () => undefined },
  });
  mocks.driverFromConnection.mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
  mocks.createMongoRuntime.mockReturnValue(fakeRuntime);
});

describe('connect() on a mongo() client that is not connected', () => {
  it('binds the client to options and connects it', async () => {
    const db = mongo({ contract: fakeContract });

    await expect(db.connect({ url })).resolves.toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledWith(url, 'mydb');
  });
});

describe('connect() on a mongo() client that is connecting', () => {
  it('waits for a connection connect() started, then resolves with the same runtime', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    const first = db.connect();
    const second = db.connect();

    expect(await stillPending(second)).toBe(true);
    release({});
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a).toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
  });

  it('waits for a connection a query started, then resolves with the runtime', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    startQueryIgnoringItsResult();
    const connected = db.connect();

    expect(await stillPending(connected)).toBe(true);
    release({});
    await expect(connected).resolves.toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
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
    startQueryIgnoringItsResult();
    const connected = db.connect();
    release({ error: new Error('connect failed') });

    await expect(connected).rejects.toThrow('connect failed');
    await expect(db.connect()).resolves.toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(2);
  });

  it('rejects options with DRIVER.ALREADY_CONNECTED', async () => {
    const release = driverConnectsWhenReleased();
    const db = client();
    const first = db.connect();

    await expect(db.connect({ url })).rejects.toMatchObject(alreadyBound);
    release({});
    await first;
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

describe('connect() on a mongo() client that is connected', () => {
  it('resolves with the runtime after a query connected the client', async () => {
    const db = client();
    await query();

    await expect(db.connect()).resolves.toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
  });

  it('resolves with the same runtime when called twice', async () => {
    const db = client();
    const first = await db.connect();

    await expect(db.connect()).resolves.toBe(first);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
  });

  it('treats connect(undefined) as connect()', async () => {
    const db = client();
    const first = await db.connect();

    await expect(db.connect(undefined)).resolves.toBe(first);
  });

  it('rejects options with DRIVER.ALREADY_CONNECTED', async () => {
    const db = client();
    await db.connect();

    await expect(db.connect({ url })).rejects.toMatchObject({
      code: 'DRIVER.ALREADY_CONNECTED',
      message: 'Mongo client is already bound',
      why: 'connect() was given options after the client was bound to a database.',
      fix: 'Call connect() without options, or create a new client for another database.',
      meta: { extension: 'mongo' },
    });
  });
});

describe('connect() on a closed mongo() client', () => {
  it('rejects with DRIVER.NOT_CONNECTED', async () => {
    const db = client();
    await db.connect();
    await db.close();

    await expect(db.connect()).rejects.toMatchObject(closed);
  });

  it('rejects options with DRIVER.NOT_CONNECTED', async () => {
    const db = client();
    await db.close();

    await expect(db.connect({ url })).rejects.toMatchObject(closed);
  });
});

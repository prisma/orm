import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type * as MongoRuntime from '@internal/mongo-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type AnyMongoContract = MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>;

// Hoisted mocks so they are observable from inside vi.mock() factories.
const mocks = vi.hoisted(() => ({
  mongoRuntimeAdapter: { id: 'mongo-runtime-adapter' },
  mongoRuntimeTarget: { id: 'mongo-runtime-target', targetId: 'mongo' },
  createMongoExecutionStack: vi.fn(),
  createMongoExecutionContext: vi.fn(),
  createMongoRuntime: vi.fn(),
  mongoRuntimeDriver: { id: 'mongo-runtime-driver' },
  createDriver: vi.fn(),
  driverConnect: vi.fn(),
  driverClose: vi.fn(),
  deserializeContract: vi.fn(),
  mongoOrm: vi.fn(),
  mongoQuery: vi.fn(),
  mongoRaw: vi.fn(),
}));

vi.mock('@internal/adapter-mongo/runtime', () => ({
  default: mocks.mongoRuntimeAdapter,
}));

vi.mock('@internal/target-mongo/runtime', () => ({
  default: mocks.mongoRuntimeTarget,
}));

vi.mock('@internal/mongo-runtime', async (importOriginal) => ({
  enumMemberCodecFor: (await importOriginal<typeof MongoRuntime>()).enumMemberCodecFor,
  createMongoExecutionStack: mocks.createMongoExecutionStack,
  createMongoExecutionContext: mocks.createMongoExecutionContext,
  createMongoRuntime: mocks.createMongoRuntime,
}));

vi.mock('@internal/driver-mongo/runtime', () => ({
  default: mocks.mongoRuntimeDriver,
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

vi.mock('@internal/mongo-query-builder', () => ({
  mongoQuery: mocks.mongoQuery,
}));

import mongo from '../src/runtime/mongo';

const fakeContract = {
  roots: {},
  models: {},
  domain: { namespaces: { [UNBOUND_NAMESPACE_ID]: { models: {} } } },
} as unknown as AnyMongoContract;
const fakeRuntime = { id: 'runtime-instance', close: vi.fn().mockResolvedValue(undefined) };
const fakeDriver = {
  id: 'driver-instance',
  connect: mocks.driverConnect,
  close: mocks.driverClose,
};
const fakeOrm = { id: 'orm-instance' };
const fakeQuery = { id: 'query-instance' };
const fakeRaw = { id: 'raw-instance', collection: vi.fn() };
const fakeAdapter = { id: 'adapter-instance' };
const fakeContext = {
  id: 'context-instance',
  contract: fakeContract,
  codecs: { get: () => undefined },
};
const fakeStack = {
  id: 'stack-instance',
  adapter: { create: () => fakeAdapter },
  driver: { create: mocks.createDriver },
};

describe('mongo() facade', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) {
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
    }

    mocks.deserializeContract.mockReturnValue(fakeContract);
    mocks.createMongoExecutionStack.mockReturnValue(fakeStack);
    mocks.createMongoExecutionContext.mockReturnValue(fakeContext);
    mocks.createDriver.mockReturnValue(fakeDriver);
    mocks.driverConnect.mockResolvedValue(undefined);
    mocks.driverClose.mockResolvedValue(undefined);
    mocks.createMongoRuntime.mockReturnValue(fakeRuntime);
    mocks.mongoOrm.mockReturnValue(fakeOrm);
    mocks.mongoQuery.mockReturnValue(fakeQuery);
    mocks.mongoRaw.mockReturnValue(fakeRaw);
    fakeRaw.collection.mockClear();
    fakeRuntime.close.mockClear();
  });

  it('exposes orm and query eagerly without connecting the driver', () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    expect(db.orm).toBe(fakeOrm);
    expect(db.query).toBe(fakeQuery);
    expect(mocks.mongoOrm).toHaveBeenCalledTimes(1);
    expect(mocks.mongoQuery).toHaveBeenCalledTimes(1);

    expect(mocks.createDriver).not.toHaveBeenCalled();
    expect(mocks.driverConnect).not.toHaveBeenCalled();
    expect(mocks.createMongoRuntime).not.toHaveBeenCalled();
  });

  it('builds the runtime exactly once on the first runtime() call from a url', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    const first = await db.runtime();
    const second = await db.runtime();

    expect(first).toBe(fakeRuntime);
    expect(second).toBe(fakeRuntime);
    expect(mocks.createDriver).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'mongodb://localhost:27017/mydb',
      dbName: 'mydb',
    });

    // Stack and context are built upfront at construction time; each appears exactly once.
    expect(mocks.createMongoExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoExecutionStack).toHaveBeenCalledWith({
      target: mocks.mongoRuntimeTarget,
      adapter: mocks.mongoRuntimeAdapter,
      driver: mocks.mongoRuntimeDriver,
    });
    expect(mocks.createMongoExecutionContext).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoExecutionContext).toHaveBeenCalledWith({
      contract: fakeContract,
      stack: fakeStack,
    });
    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        context: fakeContext,
        adapter: fakeAdapter,
        driver: fakeDriver,
      }),
    );
    // The user-facing options bag never sees `codecs`.
    const runtimeArgs = mocks.createMongoRuntime.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(runtimeArgs).not.toHaveProperty('codecs');
    expect(runtimeArgs).not.toHaveProperty('stack');
    expect(runtimeArgs).not.toHaveProperty('targetId');
  });

  it('builds the runtime exactly once across concurrent first calls (lazy memoisation)', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    const [a, b, c] = await Promise.all([db.runtime(), db.runtime(), db.runtime()]);

    expect(a).toBe(fakeRuntime);
    expect(b).toBe(fakeRuntime);
    expect(c).toBe(fakeRuntime);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
  });

  it('accepts uri+dbName and connects the driver to the supplied dbName', async () => {
    const db = mongo({
      contract: fakeContract,
      uri: 'mongodb://localhost:27017',
      dbName: 'override_db',
    });

    await db.runtime();

    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'mongodb://localhost:27017',
      dbName: 'override_db',
    });
  });

  it('accepts a pre-built mongoClient and connects the driver to it', async () => {
    const fakeClient = { db: vi.fn() } as unknown as import('mongodb').MongoClient;
    const db = mongo({ contract: fakeContract, mongoClient: fakeClient, dbName: 'my_db' });

    await db.runtime();

    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'mongoClient',
      client: fakeClient,
      dbName: 'my_db',
    });
  });

  it('accepts an explicit binding object', async () => {
    const db = mongo({
      contract: fakeContract,
      binding: { kind: 'url', url: 'mongodb://localhost:27017/mydb', dbName: 'mydb' },
    });

    await db.runtime();

    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'mongodb://localhost:27017/mydb',
      dbName: 'mydb',
    });
  });

  it('allows deferred binding via connect() after construction', async () => {
    const db = mongo({ contract: fakeContract });

    expect(mocks.driverConnect).not.toHaveBeenCalled();

    await db.connect({ url: 'mongodb://localhost:27017/lazy_db' });

    expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'mongodb://localhost:27017/lazy_db',
      dbName: 'lazy_db',
    });
  });

  it('throws when connect() is called twice with explicit bindings', async () => {
    const db = mongo({ contract: fakeContract });

    await db.connect({ url: 'mongodb://localhost:27017/first' });
    await expect(db.connect({ url: 'mongodb://localhost:27017/second' })).rejects.toThrow(
      'Mongo client is already bound',
    );
  });

  it('throws for { url, dbName: "   " } (whitespace-only dbName) — URL without path', () => {
    expect(() =>
      mongo({
        contract: fakeContract,
        url: 'mongodb://localhost:27017',
        dbName: '   ',
      }),
    ).toThrow('Mongo binding via { url, dbName } requires a non-empty dbName');
  });

  it('trims a padded dbName before storing it on the binding', async () => {
    const db = mongo({
      contract: fakeContract,
      uri: 'mongodb://localhost:27017',
      dbName: '  padded_db  ',
    });
    await db.runtime();
    expect(mocks.driverConnect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'mongodb://localhost:27017',
      dbName: 'padded_db',
    });
  });

  it('close() closes the runtime, which owns the driver it created from the stack', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.runtime();
    await db.close();

    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
  });

  it('creates the runtime before it connects the driver', async () => {
    const order: string[] = [];
    mocks.createMongoRuntime.mockImplementation(() => {
      order.push('runtime');
      return fakeRuntime;
    });
    mocks.driverConnect.mockImplementation(async () => {
      order.push('connect');
    });
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.runtime();

    expect(order).toEqual(['runtime', 'connect']);
  });

  it('reports a runtime construction failure on every try and connects nothing', async () => {
    const failure = new Error('incompatible middleware');
    mocks.createMongoRuntime.mockImplementation(() => {
      throw failure;
    });
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await expect(db.runtime()).rejects.toBe(failure);
    await expect(db.runtime()).rejects.toBe(failure);
    await db.close();

    expect(mocks.driverConnect).not.toHaveBeenCalled();
  });

  it('close() leaves a caller-supplied mongoClient to the driver, which keeps it open', async () => {
    const fakeClient = { close: vi.fn(), db: vi.fn() };
    const db = mongo({
      contract: fakeContract,
      mongoClient: fakeClient as unknown as import('mongodb').MongoClient,
      dbName: 'my_db',
    });

    await db.runtime();
    await db.close();

    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
    expect(fakeClient.close).not.toHaveBeenCalled();
    expect(fakeClient.db).not.toHaveBeenCalled();
  });

  it('close() is a no-op when no runtime has been built', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.close();

    expect(mocks.driverClose).not.toHaveBeenCalled();
    expect(fakeRuntime.close).not.toHaveBeenCalled();
  });

  it('close() is idempotent (only disposes the owned driver once across repeated calls)', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.runtime();
    await db.close();
    await db.close();

    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
  });

  it('clears the cached runtime promise after a failed first build, so a later call can retry', async () => {
    mocks.driverConnect
      .mockReset()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(undefined);

    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await expect(db.runtime()).rejects.toThrow('connection refused');

    const runtime = await db.runtime();
    expect(runtime).toBe(fakeRuntime);
    expect(mocks.driverConnect).toHaveBeenCalledTimes(2);
    expect(mocks.createDriver).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
  });

  it('close() after a failed connect closes the runtime it created', async () => {
    mocks.driverConnect.mockReset().mockRejectedValueOnce(new Error('connection refused'));
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await expect(db.runtime()).rejects.toThrow('connection refused');
    await db.close();

    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
  });

  it('close() before any build is a no-op and locks the client', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.close();

    expect(mocks.driverClose).not.toHaveBeenCalled();
    expect(fakeRuntime.close).not.toHaveBeenCalled();
    await expect(db.runtime()).rejects.toThrow('Mongo client is closed');
  });

  it.each(['query', 'execute'] as const)(
    'the ORM %s on a closed client rejects instead of throwing at the call',
    async (member) => {
      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      const executor = mocks.mongoOrm.mock.calls.at(-1)?.[0].runtime;
      await db.close();

      let result: PromiseLike<unknown> | undefined;
      expect(() => {
        result = executor[member]({});
      }).not.toThrow();
      await expect(Promise.resolve(result)).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
    },
  );

  it('close() while a build is in flight locks the client and still closes the runtime after the build fails', async () => {
    mocks.driverConnect.mockReset().mockRejectedValueOnce(new Error('connection refused'));

    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    const inflight = db.runtime().catch(() => undefined);
    await db.close();
    await inflight;

    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
    await expect(db.runtime()).rejects.toThrow('Mongo client is closed');
  });

  it('await using db executes [Symbol.asyncDispose] on scope exit (driver.close called)', async () => {
    async function run() {
      await using db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      await db.runtime();
    }

    await run();
    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
  });

  describe('db.runtime().query', () => {
    it('executes row plans through the connected runtime', async () => {
      const fakeRows = [{ id: 1 }, { id: 2 }];
      const fakePlan = { id: 'fake-plan' };
      const fakeRuntimeWithQuery = {
        ...fakeRuntime,
        query: vi.fn(async function* () {
          yield* fakeRows;
        }),
      };
      mocks.createMongoRuntime.mockReturnValue(fakeRuntimeWithQuery);

      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      const runtime = await db.runtime();
      const result = runtime.query(fakePlan as never);

      const collected: unknown[] = [];
      for await (const row of result) {
        collected.push(row);
      }
      expect(collected).toEqual(fakeRows);
      expect(mocks.driverConnect).toHaveBeenCalledTimes(1);
      expect(fakeRuntimeWithQuery.query).toHaveBeenCalledWith(fakePlan);
    });

    it('rejects runtime access after close()', async () => {
      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      await db.close();

      await expect(db.runtime()).rejects.toThrow('Mongo client is closed');
    });
  });

  it('threads the middleware option to createMongoRuntime', async () => {
    const fakeMiddleware = { id: 'mw-a' };
    const db = mongo({
      contract: fakeContract,
      url: 'mongodb://localhost:27017/mydb',
      middleware: [fakeMiddleware as never],
    });

    await db.runtime();

    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ middleware: [fakeMiddleware] }),
    );
  });

  it('omits middleware from createMongoRuntime args when not configured', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.runtime();

    const runtimeArgs = mocks.createMongoRuntime.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(runtimeArgs).not.toHaveProperty('middleware');
  });

  describe('db.enums (facade)', () => {
    const roleEnum = {
      codecId: 'mongo/string@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    } as const;

    const contractWithEnum = {
      domain: {
        namespaces: {
          __unbound__: { models: {}, enum: { Role: roleEnum } },
        },
      },
    } as unknown as AnyMongoContract;

    const stringCodec = {
      dataType: { fromContract: (json: unknown) => json, toContract: (value: unknown) => value },
      fromDataTypeValue: (value: unknown) => value,
      toDataTypeValue: (value: unknown) => value,
    };

    beforeEach(() => {
      mocks.deserializeContract.mockReturnValue(contractWithEnum);
      mocks.createMongoExecutionContext.mockReturnValue({
        id: 'context-instance',
        contract: contractWithEnum,
        codecs: { get: (id: string) => (id === 'mongo/string@1' ? stringCodec : undefined) },
      });
    });

    function roleAccessor() {
      const db = mongo({ contract: contractWithEnum, url: 'mongodb://localhost:27017/mydb' });
      return db.enums['Role']!;
    }

    it('refuses to build a client whose runtime has no codec for an enum', () => {
      mocks.createMongoExecutionContext.mockReturnValue({
        id: 'context-instance',
        contract: contractWithEnum,
        codecs: { get: () => undefined },
      });
      expect(() =>
        mongo({ contract: contractWithEnum, url: 'mongodb://localhost:27017/mydb' }),
      ).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
          message:
            "No codec is registered for codecId 'mongo/string@1', which a domain enum in the contract uses.",
        }),
      );
    });

    it('exposes the enum accessor at db.enums.Role', () => {
      expect(roleAccessor().values).toEqual(['user', 'admin']);
    });

    it('builds the enums surface eagerly, without connecting the driver', () => {
      const db = mongo({ contract: contractWithEnum, url: 'mongodb://localhost:27017/mydb' });

      expect(db.enums['Role']!.values).toEqual(['user', 'admin']);
      expect(mocks.driverConnect).not.toHaveBeenCalled();
      expect(mocks.createMongoRuntime).not.toHaveBeenCalled();
    });
  });

  describe('db.context (facade)', () => {
    it('exposes a context object before any driver connection', () => {
      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      expect(db.context).toBeDefined();
      expect(mocks.driverConnect).not.toHaveBeenCalled();
    });

    it('context matches what createMongoExecutionContext returns', () => {
      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      expect(db.context).toEqual(fakeContext);
    });

    it('builds query, raw and orm from the one execution context', () => {
      mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      const context = fakeContext;
      expect(mocks.mongoQuery).toHaveBeenCalledWith({ context });
      expect(mocks.mongoRaw).toHaveBeenCalledWith({ context });
      expect(mocks.mongoOrm).toHaveBeenCalledWith(expect.objectContaining({ context }));
      expect(mocks.mongoOrm.mock.calls[0]?.[0]).not.toHaveProperty('contract');
    });

    it('createMongoExecutionContext is called upfront (before runtime()) with the resolved contract', () => {
      mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      expect(mocks.createMongoExecutionContext).toHaveBeenCalledTimes(1);
      expect(mocks.createMongoExecutionContext).toHaveBeenCalledWith({
        contract: fakeContract,
        stack: fakeStack,
      });
    });

    it('createMongoExecutionContext is called only once (buildRuntime reuses the upfront context)', async () => {
      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      await db.runtime();
      expect(mocks.createMongoExecutionContext).toHaveBeenCalledTimes(1);
    });

    it('buildRuntime passes the upfront context to createMongoRuntime', async () => {
      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      await db.runtime();
      expect(mocks.createMongoRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ context: fakeContext }),
      );
    });
  });
});

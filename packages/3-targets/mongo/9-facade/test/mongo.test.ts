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
  driverFromConnection: vi.fn(),
  driverFromDb: vi.fn(),
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
const fakeDriverClose = vi.fn().mockResolvedValue(undefined);
const fakeDriverFromDbClose = vi.fn().mockResolvedValue(undefined);
const fakeOrm = { id: 'orm-instance' };
const fakeQuery = { id: 'query-instance' };
const fakeRaw = { id: 'raw-instance', collection: vi.fn() };
const fakeAdapter = { id: 'adapter-instance' };
const fakeContext = {
  id: 'context-instance',
  contract: fakeContract,
  codecs: { get: () => undefined },
};
const fakeStack = { id: 'stack-instance', adapter: { create: () => fakeAdapter } };

describe('mongo() facade', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) {
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
    }

    mocks.deserializeContract.mockReturnValue(fakeContract);
    mocks.createMongoExecutionStack.mockReturnValue(fakeStack);
    mocks.createMongoExecutionContext.mockReturnValue(fakeContext);
    mocks.driverFromConnection.mockResolvedValue({
      id: 'driver-from-url',
      close: fakeDriverClose,
    });
    mocks.driverFromDb.mockReturnValue({ id: 'driver-from-db', close: fakeDriverFromDbClose });
    mocks.createMongoRuntime.mockReturnValue(fakeRuntime);
    mocks.mongoOrm.mockReturnValue(fakeOrm);
    mocks.mongoQuery.mockReturnValue(fakeQuery);
    mocks.mongoRaw.mockReturnValue(fakeRaw);
    fakeRaw.collection.mockClear();
    fakeRuntime.close.mockClear();
    fakeDriverClose.mockClear();
    fakeDriverFromDbClose.mockClear();
  });

  it('exposes orm and query eagerly without connecting the driver', () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    expect(db.orm).toBe(fakeOrm);
    expect(db.query).toBe(fakeQuery);
    expect(mocks.mongoOrm).toHaveBeenCalledTimes(1);
    expect(mocks.mongoQuery).toHaveBeenCalledTimes(1);

    expect(mocks.driverFromConnection).not.toHaveBeenCalled();
    expect(mocks.driverFromDb).not.toHaveBeenCalled();
    expect(mocks.createMongoRuntime).not.toHaveBeenCalled();
  });

  it('builds the runtime exactly once on the first runtime() call from a url', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    const first = await db.runtime();
    const second = await db.runtime();

    expect(first).toBe(fakeRuntime);
    expect(second).toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017/mydb',
      'mydb',
    );

    // Stack and context are built upfront at construction time; each appears exactly once.
    expect(mocks.createMongoExecutionStack).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoExecutionStack).toHaveBeenCalledWith({
      target: mocks.mongoRuntimeTarget,
      adapter: mocks.mongoRuntimeAdapter,
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
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
  });

  it('accepts uri+dbName and uses fromConnection with the supplied dbName', async () => {
    const db = mongo({
      contract: fakeContract,
      uri: 'mongodb://localhost:27017',
      dbName: 'override_db',
    });

    await db.runtime();

    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017',
      'override_db',
    );
  });

  it('accepts a pre-built mongoClient and uses fromDb', async () => {
    const fakeClient = { db: vi.fn().mockReturnValue({ id: 'db-handle' }) };
    const db = mongo({
      contract: fakeContract,
      mongoClient: fakeClient as unknown as import('mongodb').MongoClient,
      dbName: 'my_db',
    });

    await db.runtime();

    expect(fakeClient.db).toHaveBeenCalledWith('my_db');
    expect(mocks.driverFromDb).toHaveBeenCalledWith({ id: 'db-handle' });
    expect(mocks.driverFromConnection).not.toHaveBeenCalled();
  });

  it('accepts an explicit binding object', async () => {
    const db = mongo({
      contract: fakeContract,
      binding: { kind: 'url', url: 'mongodb://localhost:27017/mydb', dbName: 'mydb' },
    });

    await db.runtime();

    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017/mydb',
      'mydb',
    );
  });

  it('allows deferred binding via connect() after construction', async () => {
    const db = mongo({ contract: fakeContract });

    expect(mocks.driverFromConnection).not.toHaveBeenCalled();

    await db.connect({ url: 'mongodb://localhost:27017/lazy_db' });

    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017/lazy_db',
      'lazy_db',
    );
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
    expect(mocks.driverFromConnection).toHaveBeenCalledWith(
      'mongodb://localhost:27017',
      'padded_db',
    );
  });

  it('close() releases the facade-constructed driver when binding is { url }', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.runtime();
    await db.close();

    expect(fakeDriverClose).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.close).not.toHaveBeenCalled();
  });

  it('close() does NOT touch a caller-supplied mongoClient', async () => {
    const fakeClient = {
      close: vi.fn(),
      db: vi.fn().mockReturnValue({ id: 'db-handle' }),
    };
    const db = mongo({
      contract: fakeContract,
      mongoClient: fakeClient as unknown as import('mongodb').MongoClient,
      dbName: 'my_db',
    });

    await db.runtime();
    await db.close();

    expect(fakeClient.close).not.toHaveBeenCalled();
    expect(fakeDriverFromDbClose).not.toHaveBeenCalled();
    expect(fakeRuntime.close).not.toHaveBeenCalled();
    fakeClient.db('other_db');
    expect(fakeClient.db).toHaveBeenCalledWith('other_db');
  });

  it('close() is a no-op when no runtime has been built', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.close();

    expect(fakeDriverClose).not.toHaveBeenCalled();
    expect(fakeRuntime.close).not.toHaveBeenCalled();
  });

  it('close() is idempotent (only disposes the owned driver once across repeated calls)', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.runtime();
    await db.close();
    await db.close();

    expect(fakeDriverClose).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.close).not.toHaveBeenCalled();
  });

  it('clears the cached runtime promise after a failed first build, so a later call can retry', async () => {
    mocks.driverFromConnection
      .mockReset()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ id: 'driver-from-url' });

    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await expect(db.runtime()).rejects.toThrow('connection refused');
    expect(mocks.createMongoRuntime).not.toHaveBeenCalled();

    const runtime = await db.runtime();
    expect(runtime).toBe(fakeRuntime);
    expect(mocks.driverFromConnection).toHaveBeenCalledTimes(2);
    expect(mocks.createMongoRuntime).toHaveBeenCalledTimes(1);
  });

  it('close() before any build is a no-op and locks the client', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    await db.close();

    expect(fakeDriverClose).not.toHaveBeenCalled();
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

  it('close() while a build is in flight still locks the client and skips driver-close on a failed build', async () => {
    mocks.driverFromConnection.mockReset().mockRejectedValueOnce(new Error('connection refused'));

    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });

    const inflight = db.runtime().catch(() => undefined);
    await db.close();
    await inflight;

    expect(fakeDriverClose).not.toHaveBeenCalled();
    expect(fakeRuntime.close).not.toHaveBeenCalled();
    await expect(db.runtime()).rejects.toThrow('Mongo client is closed');
  });

  it('await using db executes [Symbol.asyncDispose] on scope exit (driver.close called)', async () => {
    async function run() {
      await using db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      await db.runtime();
    }

    await run();
    expect(fakeDriverClose).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.close).not.toHaveBeenCalled();
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
      expect(mocks.driverFromConnection).toHaveBeenCalledTimes(1);
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
      expect(mocks.driverFromConnection).not.toHaveBeenCalled();
      expect(mocks.createMongoRuntime).not.toHaveBeenCalled();
    });
  });

  describe('db.context (facade)', () => {
    it('exposes a context object before any driver connection', () => {
      const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
      expect(db.context).toBeDefined();
      expect(mocks.driverFromConnection).not.toHaveBeenCalled();
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

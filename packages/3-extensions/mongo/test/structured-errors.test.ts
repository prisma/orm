import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type * as MongoRuntime from '@internal/mongo-runtime';
import { isStructuredError } from '@internal/utils/structured-error';
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
  buildMongoEnums: (await importOriginal<typeof MongoRuntime>()).buildMongoEnums,
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

import { resolveMongoBinding, resolveOptionalMongoBinding } from '../src/runtime/binding';
import mongo from '../src/runtime/mongo';

const fakeContract = {
  roots: {},
  models: {},
  domain: { namespaces: { [UNBOUND_NAMESPACE_ID]: { models: {} } } },
} as unknown as AnyMongoContract;

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

async function captureAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

describe('binding validation raises RUNTIME.BINDING_INVALID', () => {
  it('empty url', () => {
    const error = capture(() => resolveMongoBinding({ url: '   ' }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Mongo URL must be a non-empty string',
      meta: { extension: 'mongo' },
    });
  });

  it('unparseable url', () => {
    const error = capture(() => resolveMongoBinding({ url: 'not a url' }));
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Mongo URL must be a valid URL',
    });
  });

  it('wrong scheme', () => {
    const error = capture(() => resolveMongoBinding({ url: 'postgres://localhost/db' }));
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Mongo URL must use mongodb:// or mongodb+srv://',
    });
  });

  it('multiple binding inputs', () => {
    const error = capture(() =>
      resolveMongoBinding({
        url: 'mongodb://localhost:27017/a',
        uri: 'mongodb://localhost:27017',
        dbName: 'b',
      } as unknown as Parameters<typeof resolveMongoBinding>[0]),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Provide one binding input: binding, url, uri+dbName, or mongoClient+dbName',
    });
  });

  it('multiple binding inputs via optional resolution', () => {
    const error = capture(() =>
      resolveOptionalMongoBinding({
        url: 'mongodb://localhost:27017/a',
        uri: 'mongodb://localhost:27017',
      }),
    );
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Provide one binding input: binding, url, uri+dbName, or mongoClient+dbName',
    });
  });

  it('whitespace-only dbName alongside url', () => {
    const error = capture(() =>
      resolveMongoBinding({ url: 'mongodb://localhost:27017/mydb', dbName: '  ' }),
    );
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Mongo binding via { url, dbName } requires a non-empty dbName',
    });
  });

  it('url without a database name in its path', () => {
    const error = capture(() => resolveMongoBinding({ url: 'mongodb://localhost:27017' }));
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message:
        'Mongo URL must include a database name in its path (e.g. mongodb://host:27017/mydb), or pass dbName explicitly',
    });
  });

  it('uri without dbName', () => {
    const error = capture(() =>
      resolveMongoBinding({ uri: 'mongodb://localhost:27017', dbName: ' ' }),
    );
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Mongo binding via { uri, dbName } requires a non-empty dbName',
    });
  });

  it('mongoClient without dbName', () => {
    const error = capture(() =>
      resolveMongoBinding({
        mongoClient: { db: vi.fn() } as unknown as import('mongodb').MongoClient,
        dbName: '',
      }),
    );
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_INVALID',
      message: 'Mongo binding via { mongoClient, dbName } requires a non-empty dbName',
    });
  });
});

describe('facade lifecycle structured codes', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) {
      fn.mockReset();
    }
    mocks.deserializeContract.mockReturnValue(fakeContract);
    mocks.createMongoExecutionStack.mockReturnValue({ id: 'stack' });
    mocks.createMongoExecutionContext.mockReturnValue({ id: 'context' });
    mocks.driverFromConnection.mockResolvedValue({
      id: 'driver',
      close: vi.fn().mockResolvedValue(undefined),
    });
    mocks.createMongoRuntime.mockReturnValue({ id: 'runtime' });
    mocks.mongoOrm.mockReturnValue({ id: 'orm' });
    mocks.mongoQuery.mockReturnValue({ id: 'query' });
    mocks.mongoRaw.mockReturnValue({ id: 'raw' });
  });

  it('runtime() after close() raises DRIVER.NOT_CONNECTED', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
    await db.close();

    const error = await captureAsync(() => db.runtime());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo client is closed',
      meta: { extension: 'mongo' },
    });
  });

  it('connect() after close() raises DRIVER.NOT_CONNECTED', async () => {
    const db = mongo({ contract: fakeContract });
    await db.close();

    const error = await captureAsync(() => db.connect({ url: 'mongodb://localhost:27017/mydb' }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo client is closed',
    });
  });

  it('second connect() raises DRIVER.ALREADY_CONNECTED', async () => {
    const db = mongo({ contract: fakeContract, url: 'mongodb://localhost:27017/mydb' });
    await db.connect();

    const error = await captureAsync(() => db.connect());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'DRIVER.ALREADY_CONNECTED',
      message: 'Mongo client already connected',
      meta: { extension: 'mongo' },
    });
  });

  it('runtime() without a configured binding raises RUNTIME.BINDING_MISSING', async () => {
    const db = mongo({ contract: fakeContract });

    const error = await captureAsync(() => db.runtime());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_MISSING',
      message:
        'Mongo binding not configured. Pass url/uri+dbName/mongoClient+dbName/binding to mongo(...) or call db.connect({ ... }).',
      meta: { extension: 'mongo' },
    });
  });

  it('connect() without a binding raises RUNTIME.BINDING_MISSING', async () => {
    const db = mongo({ contract: fakeContract });

    const error = await captureAsync(() => db.connect());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.BINDING_MISSING',
      message:
        'Mongo binding not configured. Pass url/uri+dbName/mongoClient+dbName/binding to mongo(...) or call db.connect({ ... }).',
    });
  });
});

import mongoRuntimeDriver from '@internal/driver-mongo/runtime';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { defineContract, field, model } from '../src/exports/contract-builder';
import mongo from '../src/runtime/mongo';

const Account = model('Account', {
  collection: 'accounts',
  fields: {
    _id: field.objectId(),
    email: field.string(),
  },
});

const contract = defineContract({ models: { Account } });

const connect = vi.fn(async () => undefined);
let createDriver: MockInstance<typeof mongoRuntimeDriver.create>;

beforeEach(() => {
  connect.mockClear();
  createDriver = vi.spyOn(mongoRuntimeDriver, 'create');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a mongo client with no database', () => {
  it('builds a plan from its query builder without creating a driver', () => {
    const db = mongo({ contract });

    const plan = db.query.from('accounts').sort({ email: 1 }).build();

    expect(plan.collection).toBe('accounts');
    expect(createDriver).not.toHaveBeenCalled();
  });
});

describe('a mongo client given a URL', () => {
  it('creates its driver on the first use', async () => {
    createDriver.mockReturnValue({
      familyId: 'mongo',
      targetId: 'mongo',
      connect,
      execute: vi.fn(),
      run: vi.fn(),
      close: async () => undefined,
    });
    const db = mongo({ contract, url: 'mongodb://localhost:27017/app' });
    db.query.from('accounts').build();

    expect(createDriver).not.toHaveBeenCalled();

    await db.runtime();
    await db.close();

    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({
      kind: 'url',
      url: 'mongodb://localhost:27017/app',
      dbName: 'app',
    });
  });
});

describe('a mongo client whose runtime cannot be built', () => {
  const otherTarget = { name: 'for-other', familyId: 'mongo', targetId: 'other' } as const;
  const mismatch = { code: 'RUNTIME.MIDDLEWARE_TARGET_MISMATCH' };

  it('reports the middleware error on every try, without opening a connection', async () => {
    createDriver.mockImplementation(() => ({
      familyId: 'mongo',
      targetId: 'mongo',
      connect,
      execute: vi.fn(),
      run: vi.fn(),
      close: async () => undefined,
    }));
    const db = mongo({ contract, url: 'mongodb://localhost:27017/app', middleware: [otherTarget] });

    await expect(db.runtime()).rejects.toMatchObject(mismatch);
    await expect(db.connect()).rejects.toMatchObject(mismatch);
    await db.close();

    expect(connect).not.toHaveBeenCalled();
  });
});

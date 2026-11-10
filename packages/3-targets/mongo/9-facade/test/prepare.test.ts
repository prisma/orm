import mongoRuntimeDriver from '@internal/driver-mongo/runtime';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { defineContract, field, model, type } from '../src/exports/contract-builder';
import mongo from '../src/runtime/mongo';

const Account = model('Account', {
  collection: 'accounts',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
  },
});

const contract = defineContract({ models: { Account } });

const connect = vi.fn(async () => undefined);
let createDriver: MockInstance<typeof mongoRuntimeDriver.create>;

beforeEach(() => {
  connect.mockClear();
  createDriver = vi.spyOn(mongoRuntimeDriver, 'create').mockImplementation(() => ({
    familyId: 'mongo',
    targetId: 'mongo',
    connect,
    execute: vi.fn(),
    run: vi.fn(),
    close: async () => undefined,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('db.prepare', () => {
  it('prepares on a client with no binding, without connecting', async () => {
    const db = mongo({ contract });
    const byEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.email.eq(p.email))
        .build(),
    );

    expect(typeof byEmail.query).toBe('function');
    expect(connect).not.toHaveBeenCalled();
    await db.close();
  });

  it('prepares on a client with a URL without connecting', async () => {
    const db = mongo({ contract, url: 'mongodb://localhost:27017/app' });
    await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.email.eq(p.email))
        .build(),
    );

    expect(connect).not.toHaveBeenCalled();
    await db.close();
  });

  it('rejects on a closed client before creating anything', async () => {
    const db = mongo({ contract, url: 'mongodb://localhost:27017/app' });
    await db.close();
    const callback = vi.fn();

    await expect(db.prepare({ email: 'mongo/string@1' }, callback)).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo client is closed',
    });
    expect(callback).not.toHaveBeenCalled();
    expect(createDriver).not.toHaveBeenCalled();
  });

  it('rejects with the error that stops the runtime being built', async () => {
    const db = mongo({
      contract,
      middleware: [{ name: 'for-other', familyId: 'mongo', targetId: 'other' }],
    });

    await expect(
      db.prepare({ email: 'mongo/string@1' }, (p) =>
        db.query
          .from('accounts')
          .match((f) => f.email.eq(p.email))
          .build(),
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME.MIDDLEWARE_TARGET_MISMATCH' });
    await db.close();
  });
});

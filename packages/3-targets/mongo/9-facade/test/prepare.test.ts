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
let documents: Record<string, unknown>[] = [];
let createDriver: MockInstance<typeof mongoRuntimeDriver.create>;

beforeEach(() => {
  connect.mockClear();
  documents = [];
  createDriver = vi.spyOn(mongoRuntimeDriver, 'create').mockImplementation(() => ({
    familyId: 'mongo',
    targetId: 'mongo',
    connect,
    async *execute<Row>(): AsyncGenerator<Row> {
      yield* documents as Row[];
    },
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

describe('db.prepare with an ORM read', () => {
  const url = 'mongodb://localhost:27017/app';

  it('returns a frozen handle with query only', async () => {
    const db = mongo({ contract });
    const byEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).prepared.all(),
    );

    expect({ frozen: Object.isFrozen(byEmail), keys: Object.keys(byEmail) }).toEqual({
      frozen: true,
      keys: ['query'],
    });
    expect(connect).not.toHaveBeenCalled();
    await db.close();
  });

  it('runs all() as a stream of rows', async () => {
    const db = mongo({ contract, url });
    const byEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).select('email').prepared.all(),
    );
    documents = [{ email: 'a@example.com' }, { email: 'b@example.com' }];

    const rows = await byEmail.query(await db.runtime(), { email: 'a@example.com' }).toArray();

    expect(rows).toEqual([{ email: 'a@example.com' }, { email: 'b@example.com' }]);
    await db.close();
  });

  it('runs first() as one row or null', async () => {
    const db = mongo({ contract, url });
    const byEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).select('email').prepared.first(),
    );
    const runtime = await db.runtime();

    documents = [{ email: 'a@example.com' }];
    const found = await byEmail.query(runtime, { email: 'a@example.com' });
    documents = [];
    const missing = await byEmail.query(runtime, { email: 'z@example.com' });

    expect({ found, missing }).toEqual({ found: { email: 'a@example.com' }, missing: null });
    await db.close();
  });

  it('runs firstOrThrow() as one row, rejecting when there is none', async () => {
    const db = mongo({ contract, url });
    const byEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
      db.orm.accounts.where({ email: p.email }).select('email').prepared.firstOrThrow(),
    );
    const runtime = await db.runtime();

    documents = [{ email: 'a@example.com' }];
    const found = await byEmail.query(runtime, { email: 'a@example.com' });
    documents = [];

    expect(found).toEqual({ email: 'a@example.com' });
    await expect(byEmail.query(runtime, { email: 'z@example.com' })).rejects.toMatchObject({
      code: 'RUNTIME.NO_ROWS',
    });
    await db.close();
  });

  it('rejects on a closed client before calling the callback', async () => {
    const db = mongo({ contract, url });
    await db.close();
    const callback = vi.fn(() => db.orm.accounts.prepared.all());

    await expect(db.prepare({}, callback)).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo client is closed',
    });
    expect(callback).not.toHaveBeenCalled();
  });
});

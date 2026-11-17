import { describe, expect, it, vi } from 'vitest';
import { contractFromJson } from '../src/static/contract-from-json';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

vi.mock('pg', () => {
  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn(async () => ({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      on: vi.fn(),
    }));
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
    escapeIdentifier = vi.fn();
    escapeLiteral = vi.fn();
  }
  return { Pool, Client };
});

import postgresDriver from '@internal/driver-postgres/runtime';
import postgres from '../src/runtime/postgres';
import postgresServerless from '../src/runtime/postgres-serverless';

const contract = contractFromJson<Contract>(fixtureContractJson);
const url = 'postgres://localhost:5432/db';
const notConnected = { code: 'DRIVER.NOT_CONNECTED' };

// Calls `member`, requires the call itself not to throw, and returns what it returned.
function callWithoutThrowing(member: () => PromiseLike<unknown>): PromiseLike<unknown> {
  let result: PromiseLike<unknown> | undefined;
  expect(() => {
    result = member();
  }).not.toThrow();
  if (result === undefined) throw new Error('the member returned nothing');
  return result;
}

async function closedClient(options: { readonly usedBeforeClose: boolean }) {
  const db = postgres({ contract, url, verifyMarker: false });
  if (options.usedBeforeClose) {
    await db.query(db.sql.public.users.select('id').build()).toArray();
  }
  await db.close();
  return db;
}

type Client = Awaited<ReturnType<typeof closedClient>>;

const runtimeMembers: ReadonlyArray<readonly [string, (db: Client) => PromiseLike<unknown>]> = [
  ['query', (db) => db.query(db.sql.public.users.select('id').build())],
  ['execute', (db) => db.execute(db.raw.sql`UPDATE users SET name = name`.affectedCount().build())],
  ['transaction', (db) => db.transaction(async () => undefined)],
  ['orm all', (db) => db.orm.public.User.all()],
  ['orm first', (db) => db.orm.public.User.first()],
  ['orm create', (db) => db.orm.public.User.create({ email: 'ada@example.com', name: 'Ada' })],
];

const members: ReadonlyArray<readonly [string, (db: Client) => PromiseLike<unknown>]> = [
  ...runtimeMembers,
  ['prepare', (db) => db.prepare({}, () => db.sql.public.users.select('id').build())],
];

describe.each([
  ['never used', false],
  ['used', true],
] as const)('a closed postgres() client it was %s before close()', (_name, usedBeforeClose) => {
  it.each(members)('%s rejects instead of throwing at the call', async (_member, call) => {
    const db = await closedClient({ usedBeforeClose });

    await expect(Promise.resolve(callWithoutThrowing(() => call(db)))).rejects.toMatchObject(
      notConnected,
    );
  });
});

describe('a postgres() client whose driver failed to connect', () => {
  it.each(members)('%s rejects instead of throwing at the call', async (_member, call) => {
    const createDriver = postgresDriver.create.bind(postgresDriver);
    const create = vi.spyOn(postgresDriver, 'create').mockImplementationOnce((options) => {
      const driver = createDriver(options);
      vi.spyOn(driver, 'connect').mockRejectedValueOnce(new Error('connect failed'));
      return driver;
    });
    const db = postgres({ contract, url, verifyMarker: false });
    await db.connect().catch(() => undefined);
    create.mockRestore();

    await expect(Promise.resolve(callWithoutThrowing(() => call(db)))).rejects.toThrow(
      'connect failed',
    );
  });
});

describe('a closed serverless connection', () => {
  it.each(runtimeMembers)('%s rejects instead of throwing at the call', async (_member, call) => {
    const serverless = postgresServerless({ contract, verifyMarker: false });
    const db = await serverless.connect({ url });
    await db.close();

    await expect(
      Promise.resolve(callWithoutThrowing(() => call(db as unknown as Client))),
    ).rejects.toMatchObject(notConnected);
  });
});

describe('db.runtime() on a closed postgres() client', () => {
  it('still throws at the call, because it returns a runtime', async () => {
    const db = await closedClient({ usedBeforeClose: false });

    expect(() => db.runtime()).toThrow(expect.objectContaining(notConnected));
  });
});

describe('the moment a postgres() client looks up its runtime', () => {
  it('is the call, so a result created before close() and read after it fails with "Runtime is closed"', async () => {
    const db = postgres({ contract, url, verifyMarker: false });
    await db.query(db.sql.public.users.select('id').build()).toArray();
    const rows = db.query(db.sql.public.users.select('id').build());
    await db.close();

    await expect(rows.toArray()).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Runtime is closed',
    });
  });

  it('creates the driver when the first member is called, before its result is read', () => {
    const create = vi.spyOn(postgresDriver, 'create');
    const db = postgres({ contract, url, verifyMarker: false });

    db.query(db.sql.public.users.select('id').build());

    expect(create).toHaveBeenCalledOnce();
    create.mockRestore();
  });
});

describe('tx.prepare on a postgres() transaction still open after close()', () => {
  it('rejects instead of throwing at the call', async () => {
    const db = postgres({ contract, url, verifyMarker: false });

    const outcome = await db.transaction(async (tx) => {
      const closing = db.close();
      const prepared = callWithoutThrowing(() =>
        tx.prepare({}, () => tx.sql.public.users.select('id').build()),
      );
      const result = await Promise.resolve(prepared).catch((error: unknown) => error);
      return { result, closing };
    });
    await outcome.closing;

    expect(outcome.result).toMatchObject(notConnected);
  });
});

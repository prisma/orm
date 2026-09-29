import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { ifDefined } from '@internal/utils/defined';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

interface Submittable {
  submit: (...args: unknown[]) => unknown;
  read: (size: number, callback: (error: Error | null, rows: unknown[]) => void) => void;
  close: (callback: (error?: Error | null) => void) => void;
}

const recorded = vi.hoisted(() => ({
  queryArguments: [] as unknown[],
  cursorReadSizes: [] as number[],
}));

// Only mock the third-party pg boundary. Real drivers, adapters, and runtimes
// run over this fake pool and client. Like pg, `query` hands a submittable
// (a cursor) back to the caller instead of a promise.
vi.mock('pg', () => {
  function isSubmittable(value: unknown): value is Submittable {
    return (
      typeof value === 'object' &&
      value !== null &&
      'submit' in value &&
      typeof value.submit === 'function'
    );
  }

  function query(request: unknown) {
    recorded.queryArguments.push(request);
    if (isSubmittable(request)) {
      request.read = (size, callback) => {
        recorded.cursorReadSizes.push(size);
        callback(null, []);
      };
      request.close = (callback) => callback(null);
      return request;
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  class Pool {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockImplementation(async () => ({
      query,
      release: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    }));
    end = vi.fn().mockResolvedValue(undefined);
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }

  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockImplementation(query);
    end = vi.fn().mockResolvedValue(undefined);
  }

  return { Pool, Client };
});

import postgres from '../src/runtime/postgres';
import type { PostgresCursorOptions } from '../src/runtime/postgres-options';
import postgresServerless from '../src/runtime/postgres-serverless';

const fixtureContract = validateSqlContractFully<Contract>(fixtureContractJson);
const url = 'postgres://localhost:5432/db';

function cursorQueryCount(): number {
  return recorded.queryArguments.filter(
    (request) =>
      typeof request === 'object' &&
      request !== null &&
      'submit' in request &&
      typeof request.submit === 'function',
  ).length;
}

async function readUsersThroughPostgres(cursor?: PostgresCursorOptions): Promise<void> {
  await using db = postgres<Contract>({
    contractJson: fixtureContract,
    url,
    verifyMarker: false,
    ...ifDefined('cursor', cursor),
  });
  await db.runtime().query(db.sql.public.users.select('id').build()).toArray();
}

async function readUsersThroughServerless(cursor?: PostgresCursorOptions): Promise<void> {
  const serverless = postgresServerless<Contract>({
    contractJson: fixtureContract,
    verifyMarker: false,
    ...ifDefined('cursor', cursor),
  });
  await using db = await serverless.connect({ url });
  await db.runtime().query(db.sql.public.users.select('id').build()).toArray();
}

beforeEach(() => {
  recorded.queryArguments.length = 0;
  recorded.cursorReadSizes.length = 0;
});

describe('postgres() cursor option', () => {
  it('reads without a cursor by default', async () => {
    await readUsersThroughPostgres();

    expect(recorded.queryArguments.length).toBeGreaterThan(0);
    expect(cursorQueryCount()).toBe(0);
  });

  it('reads through a cursor in batches of 100 when cursor is {}', async () => {
    await readUsersThroughPostgres({});

    expect(cursorQueryCount()).toBeGreaterThan(0);
    expect(recorded.cursorReadSizes).toEqual([100]);
  });

  it('reads through a cursor when cursor.batchSize is set', async () => {
    await readUsersThroughPostgres({ batchSize: 50 });

    expect(cursorQueryCount()).toBeGreaterThan(0);
    expect(recorded.cursorReadSizes).toEqual([50]);
  });
});

describe('the cursor option is checked when the factory is called', () => {
  const disabledFlag = { disabled: true } as unknown as PostgresCursorOptions;
  const invalidCursor = (received: unknown, helper: 'postgres' | 'postgresServerless') =>
    expect.objectContaining({
      code: 'RUNTIME.ARGUMENT_INVALID',
      message: 'Invalid cursor option',
      fix: expect.stringContaining('leave cursor unset'),
      meta: { extension: 'postgres', helper, argument: 'cursor', received },
    });

  it('postgres() rejects { disabled: true } passed through a cast', () => {
    expect(() =>
      postgres<Contract>({ contractJson: fixtureContract, url, cursor: disabledFlag }),
    ).toThrow(invalidCursor({ disabled: true }, 'postgres'));
  });

  it('postgresServerless() rejects { disabled: true } passed through a cast', () => {
    expect(() =>
      postgresServerless<Contract>({ contractJson: fixtureContract, cursor: disabledFlag }),
    ).toThrow(invalidCursor({ disabled: true }, 'postgresServerless'));
  });

  it('postgres() rejects a batchSize that is not a positive integer', () => {
    expect(() =>
      postgres<Contract>({ contractJson: fixtureContract, url, cursor: { batchSize: 0 } }),
    ).toThrow(invalidCursor({ batchSize: 0 }, 'postgres'));
    expect(() =>
      postgres<Contract>({ contractJson: fixtureContract, url, cursor: { batchSize: 1.5 } }),
    ).toThrow(invalidCursor({ batchSize: 1.5 }, 'postgres'));
  });

  it('postgresServerless() rejects a batchSize that is not a positive integer', () => {
    expect(() =>
      postgresServerless<Contract>({ contractJson: fixtureContract, cursor: { batchSize: 0 } }),
    ).toThrow(invalidCursor({ batchSize: 0 }, 'postgresServerless'));
    expect(() =>
      postgresServerless<Contract>({ contractJson: fixtureContract, cursor: { batchSize: 1.5 } }),
    ).toThrow(invalidCursor({ batchSize: 1.5 }, 'postgresServerless'));
  });

  it('postgres() reads through a cursor in batches of 100 when batchSize is undefined', async () => {
    await readUsersThroughPostgres({ batchSize: undefined });

    expect(cursorQueryCount()).toBeGreaterThan(0);
    expect(recorded.cursorReadSizes).toEqual([100]);
  });

  it('postgresServerless() reads through a cursor in batches of 100 when batchSize is undefined', async () => {
    await readUsersThroughServerless({ batchSize: undefined });

    expect(cursorQueryCount()).toBeGreaterThan(0);
    expect(recorded.cursorReadSizes).toEqual([100]);
  });
});

describe('postgresServerless() cursor option', () => {
  it('reads without a cursor by default', async () => {
    await readUsersThroughServerless();

    expect(recorded.queryArguments.length).toBeGreaterThan(0);
    expect(cursorQueryCount()).toBe(0);
  });

  it('reads through a cursor in batches of 100 when cursor is {}', async () => {
    await readUsersThroughServerless({});

    expect(cursorQueryCount()).toBeGreaterThan(0);
    expect(recorded.cursorReadSizes).toEqual([100]);
  });

  it('reads through a cursor when cursor.batchSize is set', async () => {
    await readUsersThroughServerless({ batchSize: 50 });

    expect(cursorQueryCount()).toBeGreaterThan(0);
    expect(recorded.cursorReadSizes).toEqual([50]);
  });
});

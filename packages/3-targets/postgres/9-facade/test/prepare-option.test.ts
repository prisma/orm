import { ifDefined } from '@internal/utils/defined';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contractFromJson } from '../src/static/contract-from-json';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

interface RecordedQuery {
  readonly name?: string | undefined;
  readonly text?: string | undefined;
  readonly values?: readonly unknown[] | undefined;
}

const recorded = vi.hoisted(() => ({
  queries: [] as RecordedQuery[],
}));

vi.mock('pg', () => {
  /** Records query configuration objects for assertions and resolves with a fixed single-row result. */
  function query(request: unknown) {
    if (typeof request === 'object' && request !== null) {
      recorded.queries.push(request as RecordedQuery);
    }
    return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
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
import postgresServerless from '../src/runtime/postgres-serverless';

const fixtureContract = contractFromJson<Contract>(fixtureContractJson);
const url = 'postgres://localhost:5432/db';

async function runPreparedQueryThroughPostgres(prepare?: 'client' | 'database'): Promise<void> {
  await using db = postgres({
    contract: fixtureContract,
    url,
    verifyMarker: false,
    ...ifDefined('prepare', prepare),
  });
  const prepared = await db.prepare({ id: 'pg/int4@1' }, (p) =>
    db.sql.public.users
      .select('id')
      .where((f, fns) => fns.eq(f.id, p.id))
      .build(),
  );
  expect(await prepared.query(db.runtime(), { id: 41 }).toArray()).toEqual([{ id: 1 }]);
  expect(await prepared.query(db.runtime(), { id: 42 }).toArray()).toEqual([{ id: 1 }]);
}

async function runPreparedQueryThroughServerless(prepare?: 'client' | 'database'): Promise<void> {
  const serverless = postgresServerless({
    contract: fixtureContract,
    verifyMarker: false,
    ...ifDefined('prepare', prepare),
  });
  await using db = await serverless.connect({ url });
  const prepared = await db.prepare({ id: 'pg/int4@1' }, (p) =>
    db.sql.public.users
      .select('id')
      .where((f, fns) => fns.eq(f.id, p.id))
      .build(),
  );
  expect(await prepared.query(db.runtime(), { id: 41 }).toArray()).toEqual([{ id: 1 }]);
  expect(await prepared.query(db.runtime(), { id: 42 }).toArray()).toEqual([{ id: 1 }]);
}

beforeEach(() => {
  recorded.queries.length = 0;
});

describe('postgres() prepare option', () => {
  it('uses server-side prepared statements by default', async () => {
    await runPreparedQueryThroughPostgres();

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('uses server-side prepared statements when prepare is database', async () => {
    await runPreparedQueryThroughPostgres('database');

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('issues anonymous queries when prepare is client', async () => {
    await runPreparedQueryThroughPostgres('client');

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.slice(-2).map(({ name, values }) => ({ name, values }))).toEqual([
      { name: undefined, values: [41] },
      { name: undefined, values: [42] },
    ]);
  });
});

describe('postgresServerless() prepare option', () => {
  it('uses server-side prepared statements by default', async () => {
    await runPreparedQueryThroughServerless();

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('uses server-side prepared statements when prepare is database', async () => {
    await runPreparedQueryThroughServerless('database');

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('issues anonymous queries when prepare is client', async () => {
    await runPreparedQueryThroughServerless('client');

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.slice(-2).map(({ name, values }) => ({ name, values }))).toEqual([
      { name: undefined, values: [41] },
      { name: undefined, values: [42] },
    ]);
  });
});

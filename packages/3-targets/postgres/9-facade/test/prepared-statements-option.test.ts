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

async function runPreparedQueryThroughPostgres(preparedStatements?: boolean): Promise<void> {
  await using db = postgres({
    contract: fixtureContract,
    url,
    verifyMarker: false,
    ...ifDefined('preparedStatements', preparedStatements),
  });
  const prepared = await db.prepare({ id: 'pg/int4@1' }, (p) =>
    db.sql.public.users
      .select('id')
      .where((f, fns) => fns.eq(f.id, p.id))
      .build(),
  );
  await prepared.query(db.runtime(), { id: 42 }).toArray();
}

async function runPreparedQueryThroughServerless(preparedStatements?: boolean): Promise<void> {
  const serverless = postgresServerless({
    contract: fixtureContract,
    verifyMarker: false,
    ...ifDefined('preparedStatements', preparedStatements),
  });
  await using db = await serverless.connect({ url });
  const prepared = await db.prepare({ id: 'pg/int4@1' }, (p) =>
    db.sql.public.users
      .select('id')
      .where((f, fns) => fns.eq(f.id, p.id))
      .build(),
  );
  await prepared.query(db.runtime(), { id: 42 }).toArray();
}

beforeEach(() => {
  recorded.queries.length = 0;
});

describe('postgres() preparedStatements option', () => {
  it('uses server-side prepared statements by default', async () => {
    await runPreparedQueryThroughPostgres();

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('uses server-side prepared statements when preparedStatements is true', async () => {
    await runPreparedQueryThroughPostgres(true);

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('issues anonymous queries when preparedStatements is false', async () => {
    await runPreparedQueryThroughPostgres(false);

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBeUndefined();
    expect(recorded.queries.at(-1)?.values).toEqual([42]);
  });
});

describe('postgresServerless() preparedStatements option', () => {
  it('uses server-side prepared statements by default', async () => {
    await runPreparedQueryThroughServerless();

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('uses server-side prepared statements when preparedStatements is true', async () => {
    await runPreparedQueryThroughServerless(true);

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBe('pn_1');
  });

  it('issues anonymous queries when preparedStatements is false', async () => {
    await runPreparedQueryThroughServerless(false);

    expect(recorded.queries.length).toBeGreaterThan(0);
    expect(recorded.queries.at(-1)?.name).toBeUndefined();
    expect(recorded.queries.at(-1)?.values).toEqual([42]);
  });
});

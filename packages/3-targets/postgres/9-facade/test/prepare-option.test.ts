import type * as DriverModule from '@internal/driver-postgres/runtime';
import type { SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contractFromJson } from '../src/static/contract-from-json';
import type { Contract } from './fixtures/generated/contract';
import fixtureContractJson from './fixtures/generated/contract.json' with { type: 'json' };

const recorded = vi.hoisted(() => ({
  requests: [] as SqlExecuteRequest[],
}));

vi.mock('@internal/driver-postgres/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof DriverModule>();

  function createRecordingDriver() {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      acquireConnection: vi.fn().mockResolvedValue({
        release: vi.fn().mockResolvedValue(undefined),
      }),
      async *query(request: SqlExecuteRequest) {
        recorded.requests.push(request);
        yield { id: 1 };
      },
      execute: vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        recorded.requests.push(request);
        return { affectedRows: 1 };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }

  return {
    ...actual,
    default: { ...actual.default, create: createRecordingDriver },
  };
});

import postgres from '../src/runtime/postgres';
import postgresServerless from '../src/runtime/postgres-serverless';

type PrepareMode = 'client' | 'database' | undefined;

const fixtureContract = contractFromJson<Contract>(fixtureContractJson);
const url = 'postgres://localhost:5432/db';

function sentRequests() {
  return recorded.requests.map((request) => ({
    params: request.params,
    hasHandle: Object.hasOwn(request, 'preparedStatementHandle'),
  }));
}

async function runPreparedQueryThroughPostgres(prepare: PrepareMode) {
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
  await prepared.query(db.runtime(), { id: 41 }).toArray();
  await prepared.query(db.runtime(), { id: 42 }).toArray();
  return sentRequests();
}

async function runPreparedQueryThroughServerless(prepare: PrepareMode) {
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
  await prepared.query(db.runtime(), { id: 41 }).toArray();
  await prepared.query(db.runtime(), { id: 42 }).toArray();
  return sentRequests();
}

const withHandle = [
  { params: [41], hasHandle: true },
  { params: [42], hasHandle: true },
];
const withoutHandle = [
  { params: [41], hasHandle: false },
  { params: [42], hasHandle: false },
];

beforeEach(() => {
  recorded.requests.length = 0;
});

describe.each([
  ['postgres()', runPreparedQueryThroughPostgres],
  ['postgresServerless()', runPreparedQueryThroughServerless],
])('the %s prepare option', (_facade, runPreparedQuery) => {
  it('hands the driver a prepared-statement handle by default', async () => {
    expect(await runPreparedQuery(undefined)).toEqual(withHandle);
  });

  it('hands the driver a prepared-statement handle when prepare is database', async () => {
    expect(await runPreparedQuery('database')).toEqual(withHandle);
  });

  it('sends prepared statements without a handle when prepare is client', async () => {
    expect(await runPreparedQuery('client')).toEqual(withoutHandle);
  });
});

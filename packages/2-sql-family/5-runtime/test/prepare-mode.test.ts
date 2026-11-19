import type { SqlDriver, SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { type PreparedParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeOptions } from '../src/sql-runtime';
import {
  createStubAdapter,
  createTestContext,
  createTestContract,
  createTestRuntime,
  createTestStackInstance,
} from './utils';

const contract = createTestContract({ storageHash: 'prepare-mode' });

function setup(prepare: RuntimeOptions['prepare']) {
  const requests: SqlExecuteRequest[] = [];
  const driver: SqlDriver = {
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      requests.push(request);
      yield { id: 1 };
    }),
    execute: vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
      requests.push(request);
      return { affectedRows: 1 };
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const runtime = createTestRuntime({
    stackInstance: createTestStackInstance(),
    context: createTestContext(contract, createStubAdapter()),
    driver,
    verifyMarker: false,
    prepare,
  });
  return { runtime, requests };
}

function rowsPlan(id: PreparedParamRef): SqlQueryPlan<{ id: unknown }> {
  return planFromAst(
    RawQueryAst.rows(['select id from "user" where id = ', id], {
      id: { codecId: 'pg/int4@1', nullable: false },
    }),
    contract,
  );
}

function affectedCountPlan(id: PreparedParamRef): SqlQueryPlan<AffectedCount> {
  return planFromAst(
    RawQueryAst.affectedCount(['update "user" set seen = now() where id = ', id]),
    contract,
  );
}

async function runPreparedQueryAndExecute(prepare: RuntimeOptions['prepare']) {
  const { runtime, requests } = setup(prepare);
  const query = await runtime.prepare({ id: 'pg/int4@1' }, (p) =>
    rowsPlan(p.id.buildAst() as PreparedParamRef),
  );
  const execute = await runtime.prepare({ id: 'pg/int4@1' }, (p) =>
    affectedCountPlan(p.id.buildAst() as PreparedParamRef),
  );

  await query.query(runtime, { id: 41 }).toArray();
  await query.query(runtime, { id: 42 }).toArray();
  await execute.execute(runtime, { id: 43 });

  return requests.map((request) => ({
    params: request.params,
    hasHandle: Object.hasOwn(request, 'preparedStatementHandle'),
  }));
}

describe('the prepare runtime option', () => {
  it('hands the driver a prepared-statement handle by default', async () => {
    expect(await runPreparedQueryAndExecute(undefined)).toEqual([
      { params: [41], hasHandle: true },
      { params: [42], hasHandle: true },
      { params: [43], hasHandle: true },
    ]);
  });

  it('hands the driver a prepared-statement handle when prepare is database', async () => {
    expect(await runPreparedQueryAndExecute('database')).toEqual([
      { params: [41], hasHandle: true },
      { params: [42], hasHandle: true },
      { params: [43], hasHandle: true },
    ]);
  });

  it('sends prepared statements without a handle when prepare is client', async () => {
    expect(await runPreparedQueryAndExecute('client')).toEqual([
      { params: [41], hasHandle: false },
      { params: [42], hasHandle: false },
      { params: [43], hasHandle: false },
    ]);
  });
});

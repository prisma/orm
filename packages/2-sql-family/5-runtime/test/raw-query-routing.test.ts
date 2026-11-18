import type { SqlDriver, SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { ParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import {
  collectAsync,
  createStubAdapter,
  createTestContext,
  createTestContract,
  createTestRuntime,
  createTestStackInstance,
} from './utils';

const contract = createTestContract({ storageHash: 'raw-query-routing' });

function createRecordingDriver(): {
  driver: SqlDriver;
  queryCalls: SqlExecuteRequest[];
  executeCalls: SqlExecuteRequest[];
} {
  const queryCalls: SqlExecuteRequest[] = [];
  const executeCalls: SqlExecuteRequest[] = [];

  const driver: SqlDriver = {
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      queryCalls.push(request);
      yield { id: 1, email: 'a@b.example' };
    }),
    execute: vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
      executeCalls.push(request);
      return { affectedRows: 3 };
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { driver, queryCalls, executeCalls };
}

function setup() {
  const adapter = createStubAdapter();
  const { driver, queryCalls, executeCalls } = createRecordingDriver();
  // What the pipeline compiled, captured where every execution passes: the
  // anchor for "the driver receives the plan the runtime compiled" without
  // restating the stub adapter's lowering in the assertion.
  const compiled: Array<{ sql: string; params: readonly unknown[] }> = [];
  const recordCompiled: SqlMiddleware = {
    name: 'compiled-recorder',
    familyId: 'sql',
    beforeEncode(plan) {
      compiled.push({ sql: plan.sql, params: plan.params });
    },
  };
  const runtime = createTestRuntime({
    stackInstance: createTestStackInstance(),
    context: createTestContext(contract, adapter),
    driver,
    verifyMarker: false,
    middleware: [recordCompiled],
  });

  return { runtime, queryCalls, executeCalls, compiled };
}

const boundId = ParamRef.of(7, { codec: { codecId: 'pg/int4@1' } });
const boundParts = ['select id, email from "user" where id = ', boundId];

function rowsPlan(): SqlQueryPlan<{ id: unknown; email: unknown }> {
  return planFromAst(
    RawQueryAst.rows(['select id, email from "user"'], {
      id: { codecId: 'pg/int4@1', nullable: false },
      email: { codecId: 'pg/text@1', nullable: false },
    }),
    contract,
  );
}

function affectedCountPlan(): SqlQueryPlan<{ affectedRows: number }> {
  return planFromAst(RawQueryAst.affectedCount(['update "user" set seen = now()']), contract);
}

describe('raw-query execution routing', () => {
  it('streams a row-returning statement through the queryable row path', async () => {
    const { runtime, queryCalls, executeCalls } = setup();

    const rows = await collectAsync(runtime.query(rowsPlan()));

    expect(rows).toEqual([{ id: 1, email: 'a@b.example' }]);
    expect(queryCalls).toHaveLength(1);
    expect(executeCalls).toHaveLength(0);
  });

  it('reports an affected-count statement through the queryable execute path', async () => {
    const { runtime, queryCalls, executeCalls } = setup();

    const stats = await runtime.execute(affectedCountPlan());

    expect(stats).toEqual({ affectedRows: 3 });
    expect(executeCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(0);
  });

  it('decodes a row plan against its declared spec on the query path', async () => {
    const { runtime } = setup();

    const rows = await collectAsync(runtime.query(rowsPlan()));

    expect(Object.keys(rows[0] ?? {})).toEqual(['id', 'email']);
  });

  it('hands each path the statement and params the pipeline compiled', async () => {
    const { runtime, queryCalls, executeCalls, compiled } = setup();

    await collectAsync(
      runtime.query(
        planFromAst(
          RawQueryAst.rows(boundParts, {
            id: { codecId: 'pg/int4@1', nullable: false },
            email: { codecId: 'pg/text@1', nullable: false },
          }),
          contract,
        ),
      ),
    );
    await runtime.execute(planFromAst(RawQueryAst.affectedCount(boundParts), contract));

    expect(queryCalls[0]).toEqual({ sql: compiled[0]?.sql, params: compiled[0]?.params });
    expect(executeCalls[0]).toEqual({ sql: compiled[1]?.sql, params: compiled[1]?.params });
  });

  it('binds the same params whichever path the statement takes', async () => {
    const { runtime, queryCalls, executeCalls } = setup();

    await collectAsync(
      runtime.query(
        planFromAst(
          RawQueryAst.rows(boundParts, {
            id: { codecId: 'pg/int4@1', nullable: false },
            email: { codecId: 'pg/text@1', nullable: false },
          }),
          contract,
        ),
      ),
    );
    await runtime.execute(planFromAst(RawQueryAst.affectedCount(boundParts), contract));

    expect(queryCalls[0]?.params).toEqual([7]);
    expect(executeCalls[0]?.params).toEqual(queryCalls[0]?.params);
  });
});

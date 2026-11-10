import type {
  MarkerReadResult,
  SqlDriver,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import { type PreparedParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { timeouts } from '@repo/test-utils';
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

const contract = createTestContract({ storageHash: 'prepared-execute' });

function createRecordingDriver(): {
  driver: SqlDriver;
  queryCalls: SqlExecuteRequest[];
  executeCalls: SqlExecuteRequest[];
  affectedRows: { value: number };
} {
  const queryCalls: SqlExecuteRequest[] = [];
  const executeCalls: SqlExecuteRequest[] = [];
  const affectedRows = { value: 3 };

  const driver: SqlDriver = {
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      queryCalls.push(request);
      yield { id: 1, email: 'a@b.example' };
    }),
    execute: vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
      executeCalls.push(request);
      return { affectedRows: affectedRows.value };
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { driver, queryCalls, executeCalls, affectedRows };
}

function setup(middleware: readonly SqlMiddleware[] = []) {
  const adapter = createStubAdapter();
  const { driver, queryCalls, executeCalls, affectedRows } = createRecordingDriver();
  const runtime = createTestRuntime({
    stackInstance: createTestStackInstance(),
    context: createTestContext(contract, adapter),
    driver,
    verifyMarker: false,
    middleware,
  });

  return { runtime, queryCalls, executeCalls, affectedRows };
}

/** `update "user" set seen = now() where id = :id` — a bind site, no row spec. */
function affectedCountPlan(id: PreparedParamRef): SqlQueryPlan<AffectedCount> {
  return planFromAst(
    RawQueryAst.affectedCount(['update "user" set seen = now() where id = ', id]),
    contract,
  );
}

function rowsPlan(): SqlQueryPlan<{ id: unknown; email: unknown }> {
  return planFromAst(
    RawQueryAst.rows(['select id, email from "user"'], {
      id: { codecId: 'pg/int4@1', nullable: false },
      email: { codecId: 'pg/text@1', nullable: false },
    }),
    contract,
  );
}

describe('prepared statements that report statistics', () => {
  it('resolves the statement statistics through the queryable execute path', async () => {
    const { runtime, queryCalls, executeCalls } = setup();
    const prepared = await runtime.prepare({ id: 'pg/int4@1' }, (p) =>
      affectedCountPlan(p.id.buildAst() as PreparedParamRef),
    );

    const stats = await prepared.execute(runtime, { id: 7 });

    expect(stats).toEqual({ affectedRows: 3 });
    expect(executeCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(0);
  });

  it('carries the prepared-statement handle on the execute request', async () => {
    const { runtime, executeCalls } = setup();
    const prepared = await runtime.prepare({ id: 'pg/int4@1' }, (p) =>
      affectedCountPlan(p.id.buildAst() as PreparedParamRef),
    );

    await prepared.execute(runtime, { id: 7 });

    expect(typeof executeCalls[0]?.preparedStatementHandle?.get).toBe('function');
    expect(typeof executeCalls[0]?.preparedStatementHandle?.set).toBe('function');
  });

  it('keeps one handle across invocations while binding each call its own params', async () => {
    const { runtime, executeCalls, affectedRows } = setup();
    const prepared = await runtime.prepare({ id: 'pg/int4@1' }, (p) =>
      affectedCountPlan(p.id.buildAst() as PreparedParamRef),
    );

    const first = await prepared.execute(runtime, { id: 7 });
    executeCalls[0]?.preparedStatementHandle?.set('driver-side-handle');
    affectedRows.value = 5;
    const second = await prepared.execute(runtime, { id: 9 });

    expect(first).toEqual({ affectedRows: 3 });
    expect(second).toEqual({ affectedRows: 5 });
    expect(executeCalls[0]?.params).toEqual([7]);
    expect(executeCalls[1]?.params).toEqual([9]);
    expect(executeCalls[1]?.preparedStatementHandle?.get()).toBe('driver-side-handle');
  });

  it('runs as a statement that returns statistics', async () => {
    const seen: string[] = [];
    const recorder: SqlMiddleware = {
      name: 'operation-recorder',
      familyId: 'sql',
      async activityStarted(activity) {
        if (activity.kind === 'statement') seen.push(activity.returns);
      },
      intercept: {
        async onQuery() {
          seen.push('onQuery');
          return undefined;
        },
        async onExecute() {
          seen.push('onExecute');
          return undefined;
        },
      },
    };
    const { runtime } = setup([recorder]);
    const prepared = await runtime.prepare({ id: 'pg/int4@1' }, (p) =>
      affectedCountPlan(p.id.buildAst() as PreparedParamRef),
    );

    await prepared.execute(runtime, { id: 7 });

    expect(seen).toEqual(['stats', 'onExecute']);
  });
});

describe('prepared statements that stream rows', () => {
  it('still streams through the queryable row path', async () => {
    const { runtime, queryCalls, executeCalls } = setup();
    const prepared = await runtime.prepare({}, () => rowsPlan());

    const rows = await collectAsync(prepared.query(runtime, {}));

    expect(rows).toEqual([{ id: 1, email: 'a@b.example' }]);
    expect(queryCalls).toHaveLength(1);
    expect(executeCalls).toHaveLength(0);
  });
});

describe('aborting a prepared execute', () => {
  /**
   * Marker verification is the one await between the caller's last chance to
   * abort and the driver call, so it is where a signal has to be honoured: a
   * runtime that only checked on entry would verify the marker, notice
   * nothing, and execute the statement the caller had already given up on.
   */
  function setupWithSlowMarker() {
    const { driver, queryCalls, executeCalls } = createRecordingDriver();
    const stackInstance = createTestStackInstance();

    let releaseMarker: (() => void) | undefined;
    const markerRead = new Promise<void>((resolve) => {
      releaseMarker = resolve;
    });
    const readingMarker = new Promise<void>((resolve) => {
      (
        stackInstance.adapter.profile as unknown as { readMarker: () => Promise<MarkerReadResult> }
      ).readMarker = async () => {
        resolve();
        await markerRead;
        return { kind: 'absent' as const };
      };
    });

    const runtime = createTestRuntime({
      stackInstance,
      context: createTestContext(contract, createStubAdapter()),
      driver,
      verifyMarker: 'onFirstUse',
    });

    return {
      runtime,
      queryCalls,
      executeCalls,
      readingMarker,
      releaseMarker: () => releaseMarker?.(),
    };
  }

  it('raises before reaching the driver when the signal aborts during marker verification', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const { runtime, executeCalls, queryCalls, readingMarker, releaseMarker } =
      setupWithSlowMarker();
    const prepared = await runtime.prepare({ id: 'pg/int4@1' }, (p) =>
      affectedCountPlan(p.id.buildAst() as PreparedParamRef),
    );

    const controller = new AbortController();
    const pending = prepared.execute(runtime, { id: 7 }, { signal: controller.signal });

    await readingMarker;
    controller.abort();
    releaseMarker();

    await expect(pending).rejects.toMatchObject({ code: 'RUNTIME.ABORTED' });
    expect(executeCalls).toEqual([]);
    expect(queryCalls).toEqual([]);
  });
});

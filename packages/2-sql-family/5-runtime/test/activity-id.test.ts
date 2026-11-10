import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { SqlDriver, SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import {
  BinaryExpr,
  ColumnRef,
  collectOrderedParamRefs,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { Expression, ScopeField } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware, SqlMiddlewareContext } from '../src/middleware/sql-middleware';
import { createSqlExecutionStack } from '../src/sql-context';
import {
  createTestRuntime as createRuntime,
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContext,
  createTestContract,
  createTestTargetDescriptor,
} from './utils';

/**
 * Every `query()`, `execute()` and `PreparedStatement.query()` call is a fresh statement activity: its hooks see one `activity.id` and one context, and two calls of the same plan or prepared statement see distinct ones.
 */

const testContract = createTestContract({ targetFamily: 'sql', target: 'postgres' });

function createMockDriver(rows: ReadonlyArray<Record<string, unknown>> = []): SqlDriver {
  const query = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    for (const row of rows) yield row;
  });
  return {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query,
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createSetup(middleware: readonly SqlMiddleware[]) {
  const adapter = createStubAdapter();
  const driver = createMockDriver([{ id: 1 }]);
  const targetDescriptor = createTestTargetDescriptor();
  const adapterDescriptor = createTestAdapterDescriptor(adapter);
  const stack = createSqlExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensions: [],
  });
  const stackInstance = instantiateExecutionStack(stack);
  const context = createTestContext(testContract, adapter);
  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verifyMarker: false,
    middleware,
  });
  return { runtime, adapter, driver };
}

const meta = {
  target: testContract.target,
  storageHash: testContract.storage.storageHash,
  lane: 'dsl' as const,
};

function buildSelectAllUsersPlan(): SqlQueryPlan<{ id: number }> {
  const users = TableSource.named('users');
  const ast = SelectAst.from(users).withProjection([
    ProjectionItem.of('id', ColumnRef.of('id', 'users'), { codecId: 'pg/int4@1' }),
  ]);
  return Object.freeze({
    ast,
    params: collectOrderedParamRefs(ast).map((r) => (r.kind === 'param-ref' ? r.value : undefined)),
    meta,
  });
}

function buildEqUserIdPlan(userId: Expression<ScopeField>): SqlQueryPlan<{ id: number }> {
  const users = TableSource.named('users');
  const ast = SelectAst.from(users)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('id', 'users'), { codecId: 'pg/int4@1' }),
    ])
    .withWhere(BinaryExpr.eq(ColumnRef.of('id', 'users'), userId.buildAst()));
  return Object.freeze({
    ast,
    params: collectOrderedParamRefs(ast).map((r) => (r.kind === 'param-ref' ? r.value : undefined)),
    meta,
  });
}

interface Observation {
  readonly hook: 'activityStarted' | 'beforeEncode' | 'activityEnded';
  readonly id: string | undefined;
  readonly ctx: SqlMiddlewareContext;
}

function observerMiddleware(log: Observation[]): SqlMiddleware {
  return {
    name: 'observer',
    familyId: 'sql',
    async activityStarted(activity, ctx) {
      log.push({ hook: 'activityStarted', id: activity.id, ctx });
    },
    async beforeEncode(_plan, ctx) {
      log.push({ hook: 'beforeEncode', id: undefined, ctx });
    },
    async activityEnded(activity, _result, ctx) {
      log.push({ hook: 'activityEnded', id: activity.id, ctx });
    },
  };
}

function expectOneActivity(observations: readonly Observation[]): void {
  expect(observations.map((o) => o.hook)).toEqual([
    'activityStarted',
    'beforeEncode',
    'activityEnded',
  ]);
  expect(observations[0]?.id).toBeTypeOf('string');
  expect(observations[0]?.id).toBe(observations[2]?.id);
  expect(new Set(observations.map((o) => o.ctx)).size).toBe(1);
}

function expectDistinctActivities(log: readonly Observation[]): void {
  const first = log.slice(0, 3);
  const second = log.slice(3);
  expectOneActivity(first);
  expectOneActivity(second);
  expect(first[0]?.id).not.toBe(second[0]?.id);
  expect(first[0]?.ctx).not.toBe(second[0]?.ctx);
}

describe('SqlRuntime statement activity identity', () => {
  it('gives every hook of one query the same activity id and context', async () => {
    const log: Observation[] = [];
    const { runtime } = createSetup([observerMiddleware(log)]);

    await runtime.query(buildSelectAllUsersPlan()).toArray();

    expectOneActivity(log);
  });

  it('gives two executions of the same plan instance distinct activities', async () => {
    const log: Observation[] = [];
    const { runtime } = createSetup([observerMiddleware(log)]);
    const plan = buildSelectAllUsersPlan();

    await runtime.query(plan).toArray();
    await runtime.query(plan).toArray();

    expectDistinctActivities(log);
  });
});

describe('beforeCompile in a statement activity', () => {
  it('receives the same context as the statement other hooks', async () => {
    const contexts: SqlMiddlewareContext[] = [];
    const recorder: SqlMiddleware = {
      name: 'compile-recorder',
      familyId: 'sql',
      async activityStarted(_activity, ctx) {
        contexts.push(ctx);
      },
      async beforeCompile(_draft, ctx) {
        contexts.push(ctx);
        return undefined;
      },
      async beforeEncode(_plan, ctx) {
        contexts.push(ctx);
      },
    };
    const { runtime } = createSetup([recorder]);

    await runtime.query(buildSelectAllUsersPlan()).toArray();

    expect(contexts).toHaveLength(3);
    expect(new Set(contexts).size).toBe(1);
  });
});

describe('PreparedStatement.query activity identity', () => {
  it('gives every hook of one statement.query call the same activity id and context', async () => {
    const log: Observation[] = [];
    const { runtime } = createSetup([observerMiddleware(log)]);
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan(params.userId),
    );

    await ps.query(runtime, { userId: 1 }).toArray();

    expectOneActivity(log);
  });

  it('gives two statement.query calls on the same prepared statement distinct activities', async () => {
    const log: Observation[] = [];
    const { runtime } = createSetup([observerMiddleware(log)]);
    const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
      buildEqUserIdPlan(params.userId),
    );

    await ps.query(runtime, { userId: 1 }).toArray();
    await ps.query(runtime, { userId: 2 }).toArray();

    expectDistinctActivities(log);
  });
});

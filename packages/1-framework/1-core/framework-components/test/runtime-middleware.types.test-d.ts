import type { PlanMeta } from '@internal/contract/types';
import { assertType, expectTypeOf, test } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import type {
  Activity,
  ActivityContext,
  ActivityEndedResult,
  ActivityFinalizedResult,
  CrossFamilyMiddleware,
  ExecuteInterceptResult,
  QueryInterceptResult,
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeStatementStats,
} from '../src/execution/runtime-middleware';

test('framework ExecutionPlan satisfies RuntimeExecutor plan constraint', () => {
  type Executor = RuntimeExecutor<ExecutionPlan>;
  expectTypeOf<Executor>().toHaveProperty('execute');
  expectTypeOf<Executor>().toHaveProperty('close');
});

test('SQL-shaped plan satisfies RuntimeExecutor plan constraint', () => {
  interface SqlShapedPlan extends QueryPlan {
    readonly sql: string;
    readonly params: readonly unknown[];
  }
  type SqlExecutor = RuntimeExecutor<SqlShapedPlan>;
  expectTypeOf<SqlExecutor>().toHaveProperty('execute');
  expectTypeOf<SqlExecutor>().toHaveProperty('close');
});

test('MongoQueryPlan-shaped type satisfies RuntimeExecutor plan constraint', () => {
  interface MongoLikePlan extends QueryPlan {
    readonly collection: string;
    readonly command: unknown;
  }
  type MongoExecutor = RuntimeExecutor<MongoLikePlan>;
  expectTypeOf<MongoExecutor>().toHaveProperty('execute');
  expectTypeOf<MongoExecutor>().toHaveProperty('close');
});

test('type without meta does not satisfy plan constraint', () => {
  // @ts-expect-error - missing meta property required by QueryPlan
  type _Invalid = RuntimeExecutor<{ sql: string }>;
});

test('RuntimeMiddleware default plan parameter sees only QueryPlan fields', () => {
  const middleware: RuntimeMiddleware = {
    name: 'test',
    async beforeEncode(plan, ctx) {
      assertType<PlanMeta>(plan.meta);
      assertType<ActivityContext>(ctx);
    },
    async onRow(row, plan) {
      assertType<Record<string, unknown>>(row);
      assertType<PlanMeta>(plan.meta);
    },
  };
  void middleware;
});

test('the statement hooks narrow the plan parameter to the family plan', () => {
  interface SqlExec extends ExecutionPlan {
    readonly sql: string;
    readonly params: readonly unknown[];
  }
  const middleware: RuntimeMiddleware<SqlExec> = {
    name: 'sql',
    async beforeEncode(plan) {
      assertType<string>(plan.sql);
    },
    intercept: {
      async onQuery(plan) {
        assertType<readonly unknown[]>(plan.params);
        return undefined;
      },
      async onExecute(plan) {
        assertType<string>(plan.sql);
        return undefined;
      },
    },
    async onRow(_row, plan) {
      assertType<string>(plan.sql);
    },
  };
  void middleware;
});

test('a middleware with only lifecycle events is a cross-family middleware', () => {
  const observer = {
    name: 'observer',
    async activityStarted(activity: Activity, ctx: ActivityContext) {
      void activity;
      void ctx;
    },
    async activityEnded(_activity: Activity, _result: ActivityEndedResult) {},
    async activityFinalized(_activity: Activity, _result: ActivityFinalizedResult) {},
  };
  expectTypeOf(observer).toExtend<CrossFamilyMiddleware>();
  expectTypeOf(observer).toExtend<RuntimeMiddleware>();
  const middleware: CrossFamilyMiddleware[] = [observer];
  void middleware;
});

test('the intercept handlers return their own result type', () => {
  type Intercept = NonNullable<RuntimeMiddleware['intercept']>;
  expectTypeOf<ReturnType<NonNullable<Intercept['onQuery']>>>().toEqualTypeOf<
    Promise<QueryInterceptResult | undefined>
  >();
  expectTypeOf<ReturnType<NonNullable<Intercept['onExecute']>>>().toEqualTypeOf<
    Promise<ExecuteInterceptResult | undefined>
  >();
});

test('intercept.onQuery returning statistics does not compile, nor onExecute returning rows', () => {
  const wrongQuery: RuntimeMiddleware = {
    name: 'wrong-query',
    intercept: {
      // @ts-expect-error - onQuery supplies rows, not statistics
      async onQuery() {
        return { stats: { affectedRows: 1 } };
      },
    },
  };
  const wrongExecute: RuntimeMiddleware = {
    name: 'wrong-execute',
    intercept: {
      // @ts-expect-error - onExecute supplies statistics, not rows
      async onExecute() {
        return { rows: [{ id: 1 }] };
      },
    },
  };
  void wrongQuery;
  void wrongExecute;
});

test('the lifecycle events receive the activity, its result and its context', () => {
  type Middleware = Required<RuntimeMiddleware>;
  expectTypeOf<Parameters<Middleware['activityStarted']>>().toEqualTypeOf<
    [Activity, ActivityContext]
  >();
  expectTypeOf<Parameters<Middleware['activityEnded']>>().toEqualTypeOf<
    [Activity, ActivityEndedResult, ActivityContext]
  >();
  expectTypeOf<Parameters<Middleware['activityFinalized']>>().toEqualTypeOf<
    [Activity, ActivityFinalizedResult, ActivityContext]
  >();
  expectTypeOf<ReturnType<Middleware['activityFinalized']>>().toEqualTypeOf<Promise<void>>();
  expectTypeOf<ActivityFinalizedResult['outcome']>().toEqualTypeOf<
    'committed' | 'rolled-back' | 'unknown'
  >();
});

test('activityEnded narrows its result by kind and by returns', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'narrowing',
    async activityEnded(activity, result) {
      if (activity.kind === 'statement') {
        expectTypeOf(activity.returns).toEqualTypeOf<'rows' | 'stats'>();
        assertType<PlanMeta>(activity.plan.meta);
      }
      if (result.kind === 'transaction') {
        expectTypeOf(result.outcome).toEqualTypeOf<'succeeded' | 'failed'>();
        // @ts-expect-error - a transaction result has no latency
        void result.latencyMs;
        return;
      }
      if (result.kind !== 'statement') return;
      expectTypeOf(result.outcome).toEqualTypeOf<'succeeded' | 'failed' | 'stopped'>();
      expectTypeOf(result.latencyMs).toEqualTypeOf<number>();
      expectTypeOf(result.source).toEqualTypeOf<'driver' | 'middleware'>();
      if (result.returns === 'rows') {
        expectTypeOf(result.rowCount).toEqualTypeOf<number>();
        // @ts-expect-error - a rows result carries no statistics
        void result.stats;
      } else {
        expectTypeOf(result.stats).toEqualTypeOf<RuntimeStatementStats | undefined>();
        // @ts-expect-error - a statistics result carries no row count
        void result.rowCount;
      }
    },
  };
  void middleware;
});

test('ActivityContext has the runtime fields and the tree members', () => {
  expectTypeOf<ActivityContext>().toHaveProperty('contract');
  expectTypeOf<ActivityContext>().toHaveProperty('mode');
  expectTypeOf<ActivityContext>().toHaveProperty('log');
  expectTypeOf<ActivityContext>().toHaveProperty('now');
  expectTypeOf<ActivityContext['contentHash']>().returns.resolves.toBeString();
  expectTypeOf<ActivityContext['scope']>().toEqualTypeOf<
    'runtime' | 'connection' | 'transaction'
  >();
  expectTypeOf<ActivityContext['parent']>().toEqualTypeOf<ActivityContext | undefined>();
  expectTypeOf<ActivityContext['state']>().toEqualTypeOf<
    (key: string | symbol) => Record<string | symbol, unknown>
  >();
  expectTypeOf<ActivityContext['inTransaction']>().toEqualTypeOf<() => boolean>();
  expectTypeOf<ActivityContext>().not.toHaveProperty('operation');
});

test('QueryInterceptResult.rows accepts Iterable, AsyncIterable, and arrays', () => {
  // Array (which is also Iterable) — common case for cached rows.
  const fromArray: QueryInterceptResult = {
    rows: [{ id: 1 }, { id: 2 }],
  };
  void fromArray;

  // Sync generator (Iterable).
  function* syncGen(): Generator<Record<string, unknown>, void, unknown> {
    yield { id: 1 };
  }
  const fromSyncGen: QueryInterceptResult = {
    rows: syncGen(),
  };
  void fromSyncGen;

  // Async generator (AsyncIterable).
  async function* asyncGen(): AsyncGenerator<Record<string, unknown>, void, unknown> {
    yield { id: 1 };
  }
  const fromAsyncGen: QueryInterceptResult = {
    rows: asyncGen(),
  };
  void fromAsyncGen;
});

test('QueryInterceptResult rejects rows whose elements are not Record<string, unknown>', () => {
  // @ts-expect-error - row elements must be Record<string, unknown>
  const _bad: QueryInterceptResult = { rows: [1, 2, 3] };
});

test('RuntimeMiddleware familyId and targetId are optional', () => {
  const generic: RuntimeMiddleware = { name: 'generic' };
  const familyBound: RuntimeMiddleware = { name: 'sql-only', familyId: 'sql' };
  const targetBound: RuntimeMiddleware = {
    name: 'pg-only',
    familyId: 'sql',
    targetId: 'postgres',
  };
  void generic;
  void familyBound;
  void targetBound;
});

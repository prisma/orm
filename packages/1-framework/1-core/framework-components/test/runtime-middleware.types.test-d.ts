import type { PlanMeta } from '@internal/contract/types';
import { assertType, expectTypeOf, test } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import type {
  AfterTransactionResult,
  CrossFamilyMiddleware,
  QueryInterceptResult,
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
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
    async beforeQuery(plan) {
      assertType<PlanMeta>(plan.meta);
    },
    async onRow(row, plan) {
      assertType<Record<string, unknown>>(row);
      assertType<PlanMeta>(plan.meta);
    },
    async afterQuery(plan, result) {
      assertType<PlanMeta>(plan.meta);
      assertType<number>(result.rowCount);
      assertType<number>(result.latencyMs);
      assertType<boolean>(result.completed);
      assertType<'driver' | 'middleware'>(result.source);
    },
  };
  void middleware;
});

test('RuntimeMiddleware.interceptQuery is optional', () => {
  // No `interceptQuery` field — perfectly valid.
  const observer: RuntimeMiddleware = {
    name: 'observer',
    async beforeQuery() {},
  };
  void observer;
});

test('RuntimeMiddleware.interceptQuery receives the plan and context, returns Promise<QueryInterceptResult | undefined>', () => {
  const interceptQueryor: RuntimeMiddleware = {
    name: 'interceptQueryor',
    async interceptQuery(plan, ctx) {
      assertType<PlanMeta>(plan.meta);
      assertType<RuntimeMiddlewareContext>(ctx);
      return undefined;
    },
  };
  void interceptQueryor;

  // The hook's return type is exactly `Promise<QueryInterceptResult | undefined>`.
  type InterceptHook = NonNullable<RuntimeMiddleware['interceptQuery']>;
  expectTypeOf<ReturnType<InterceptHook>>().toEqualTypeOf<
    Promise<QueryInterceptResult | undefined>
  >();
});

test('RuntimeMiddleware.interceptQuery narrows the plan parameter alongside other hooks', () => {
  interface SqlExec extends ExecutionPlan {
    readonly sql: string;
    readonly params: readonly unknown[];
  }
  const middleware: RuntimeMiddleware<SqlExec> = {
    name: 'sql-interceptQueryor',
    async interceptQuery(plan) {
      assertType<string>(plan.sql);
      assertType<readonly unknown[]>(plan.params);
      return undefined;
    },
  };
  void middleware;
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

test('RuntimeMiddleware narrowed to a SQL plan sees the SQL fields', () => {
  interface SqlExec extends ExecutionPlan {
    readonly sql: string;
    readonly params: readonly unknown[];
  }
  const middleware: RuntimeMiddleware<SqlExec> = {
    name: 'sql-test',
    async beforeQuery(plan) {
      assertType<string>(plan.sql);
      assertType<readonly unknown[]>(plan.params);
    },
  };
  void middleware;
});

test('RuntimeMiddlewareContext has contract, mode, log, now, contentHash, scope', () => {
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('contract');
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('mode');
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('log');
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('now');
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('contentHash');
  expectTypeOf<RuntimeMiddlewareContext['contentHash']>().toBeFunction();
  expectTypeOf<RuntimeMiddlewareContext['contentHash']>().returns.resolves.toBeString();
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('scope');
  expectTypeOf<RuntimeMiddlewareContext['scope']>().toEqualTypeOf<
    'runtime' | 'connection' | 'transaction'
  >();
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

test('CrossFamilyMiddleware accepts an afterTransaction hook with the plan, outcome and context', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'after-transaction',
    async afterTransaction(plan, result, ctx) {
      assertType<PlanMeta>(plan.meta);
      expectTypeOf(result.outcome).toEqualTypeOf<'committed' | 'rolled-back' | 'unknown'>();
      assertType<RuntimeMiddlewareContext>(ctx);
    },
  };
  void middleware;

  type AfterTransactionHook = NonNullable<RuntimeMiddleware['afterTransaction']>;
  expectTypeOf<Parameters<AfterTransactionHook>[1]>().toEqualTypeOf<AfterTransactionResult>();
  expectTypeOf<ReturnType<AfterTransactionHook>>().toEqualTypeOf<Promise<void>>();
});

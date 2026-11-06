import type { Contract, PlanMeta } from '@internal/contract/types';
import type {
  Activity,
  ActivityContext,
  ActivityEndedResult,
  ActivityFinalizedResult,
  ActivityInterceptResult,
  ClientActivity,
  ExecuteInterceptResult,
  QueryInterceptResult,
  RuntimeMiddleware,
} from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyQueryAst } from '@internal/sql-relational-core/ast';
import type { SqlParamRefMutator } from '@internal/sql-relational-core/middleware';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';

export interface SqlMiddlewareContext extends ActivityContext {
  readonly contract: Contract<SqlStorage>;
}

/**
 * Pre-lowering query view passed to `beforeCompile`. Carries the typed SQL
 * AST and plan metadata; `sql`/`params` are produced later by the adapter.
 */
export interface DraftPlan {
  readonly ast: AnyQueryAst;
  readonly meta: PlanMeta;
}

export interface SqlMiddleware<TCodecMap extends Record<string, unknown> = Record<string, unknown>>
  extends RuntimeMiddleware<SqlExecutionPlan, SqlParamRefMutator<TCodecMap>> {
  readonly familyId?: 'sql';
  activityStarted?(activity: Activity, ctx: SqlMiddlewareContext): Promise<void>;
  activityEnded?(
    activity: Activity,
    result: ActivityEndedResult,
    ctx: SqlMiddlewareContext,
  ): Promise<void>;
  activityFinalized?(
    activity: Activity,
    result: ActivityFinalizedResult,
    ctx: SqlMiddlewareContext,
  ): Promise<void>;
  /**
   * Rewrite the query AST before it is lowered to SQL. Middlewares run in
   * registration order; each sees the predecessor's output, so rewrites
   * compose (e.g. soft-delete + tenant isolation).
   *
   * Return `undefined` (or a draft whose `ast` reference equals the input's)
   * to pass through. Return a draft with a new `ast` reference to replace it;
   * the runtime emits a `middleware.rewrite` debug log event and continues
   * with the new draft. `adapter.lower()` runs once after the chain.
   *
   * Use `AstRewriter` / `SelectAst.withWhere` / `AndExpr.of` etc. to build
   * the rewritten AST. Predicates and literals go through parameterized
   * constructors by default — no SQL-injection surface is added. **Warning:**
   * constructing `LiteralExpr.of(userInput)` from untrusted input bypasses
   * that guarantee; use `ParamRef.of(userInput, ...)` instead.
   *
   * See `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`.
   */
  beforeCompile?(draft: DraftPlan, ctx: SqlMiddlewareContext): Promise<DraftPlan | undefined>;
  /**
   * Runs after lowering, before parameter encoding: `beforeCompile → lowerSqlPlan → beforeEncode → encodeParams → intercept → driver`. Throw to block the statement.
   *
   * `plan.params[i]` is the user-domain value the mutator's `entries()` surfaces. Changes made through `params.replaceValue` / `replaceValues` are encoded through the column's codec. A body that ignores `ctx.signal` still fails promptly with `RUNTIME.ABORTED { phase: 'beforeEncode' }`.
   */
  beforeEncode?(
    plan: SqlExecutionPlan,
    ctx: SqlMiddlewareContext,
    params?: SqlParamRefMutator<TCodecMap>,
  ): void | Promise<void>;
  intercept?: {
    onQuery?(
      plan: SqlExecutionPlan,
      ctx: SqlMiddlewareContext,
    ): Promise<QueryInterceptResult | undefined>;
    onExecute?(
      plan: SqlExecutionPlan,
      ctx: SqlMiddlewareContext,
    ): Promise<ExecuteInterceptResult | undefined>;
    onActivity?(
      activity: ClientActivity,
      ctx: SqlMiddlewareContext,
    ): Promise<ActivityInterceptResult | undefined>;
  };
  onRow?(
    row: Record<string, unknown>,
    plan: SqlExecutionPlan,
    ctx: SqlMiddlewareContext,
  ): Promise<void>;
}

import type {
  Activity,
  ActivityContext,
  ActivityEndedResult,
  ActivityFinalizedResult,
  ExecuteInterceptResult,
  QueryInterceptResult,
  RuntimeMiddleware,
} from '@internal/framework-components/runtime';
import type { MongoExecutionPlan } from './mongo-execution-plan';
import type { MongoParamRefMutator } from './param-ref-mutator';

/**
 * Activity context for Mongo. See {@link MongoMiddleware} for the plan's command during `beforeEncode` versus later hooks.
 */
export interface MongoMiddlewareContext extends ActivityContext {
  /**
   * Stable digest of `meta.storageHash` plus the **resolved** wire command. Valid only on plans after `resolveParams` (`intercept`, `onRow`, or a plan kept from them). Calling it from `beforeEncode` throws `RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND`, because `plan.command` is still an unresolved draft there.
   */
  contentHash(exec: MongoExecutionPlan): Promise<string>;
}

/**
 * Mongo-domain middleware over `MongoExecutionPlan`. `familyId` is optional so cross-family middleware remain assignable; when present it must be `'mongo'`. Mongo has no transactions, so every activity is finalized right after it ends.
 *
 * **`beforeEncode` sees an unresolved command:** `plan.command` holds the `MongoLoweredDraft`, not a wire command. Observe and change parameters through `params.entries()` / `replaceValue` / `replaceValues` only, and do not call `ctx.contentHash` there. After the hook, `resolveParams` produces the frozen wire command that `intercept`, `onRow` and `contentHash` see.
 */
export interface MongoMiddleware
  extends RuntimeMiddleware<MongoExecutionPlan, MongoParamRefMutator> {
  readonly familyId?: 'mongo';
  activityStarted?(activity: Activity, ctx: MongoMiddlewareContext): Promise<void>;
  activityEnded?(
    activity: Activity,
    result: ActivityEndedResult,
    ctx: MongoMiddlewareContext,
  ): Promise<void>;
  activityFinalized?(
    activity: Activity,
    result: ActivityFinalizedResult,
    ctx: MongoMiddlewareContext,
  ): Promise<void>;
  /** Runs after structural lowering, before `resolveParams`. Use `params` for parameter access, not `plan.command`. */
  beforeEncode?(
    plan: MongoExecutionPlan,
    ctx: MongoMiddlewareContext,
    params?: MongoParamRefMutator,
  ): void | Promise<void>;
  intercept?: {
    onQuery?(
      plan: MongoExecutionPlan,
      ctx: MongoMiddlewareContext,
    ): Promise<QueryInterceptResult | undefined>;
    onExecute?(
      plan: MongoExecutionPlan,
      ctx: MongoMiddlewareContext,
    ): Promise<ExecuteInterceptResult | undefined>;
  };
  onRow?(
    row: Record<string, unknown>,
    plan: MongoExecutionPlan,
    ctx: MongoMiddlewareContext,
  ): Promise<void>;
}

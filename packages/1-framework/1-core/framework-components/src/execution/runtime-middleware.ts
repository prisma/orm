import type { AnnotationValue, OperationKind } from '../annotations';
import type { AsyncIterableResult } from './async-iterable-result';
import type { ExecutionPlan, QueryPlan } from './query-plan';
import { runtimeError } from './runtime-error';

export interface RuntimeLog {
  info(event: unknown): void;
  warn(event: unknown): void;
  error(event: unknown): void;
  debug?(event: unknown): void;
}

/** What every activity has: an identity, a kind and the annotations the user put on it. */
export interface ActivityBase {
  /** A fresh `crypto.randomUUID()` per activity. */
  readonly id: string;
  readonly kind: string;
  /** Empty when the activity carries no annotation. */
  readonly annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;
}

/** One statement sent to the database: `query()` sends it for its rows, `execute()` for its statistics. */
export interface StatementActivity<TPlan extends QueryPlan = QueryPlan> extends ActivityBase {
  readonly kind: 'statement';
  readonly returns: 'rows' | 'stats';
  /** The plan the caller sent. */
  readonly plan: TPlan;
}

/** Started by `transaction()`, ended by `commit()` or `rollback()`. */
export interface TransactionActivity extends ActivityBase {
  readonly kind: 'transaction';
}

/** The kind of an activity a client starts. A client kind contains a hyphen, such as `orm-call`, so it is never `statement` or `transaction`. */
export type ClientActivityKind = `${string}-${string}`;

/**
 * The result types of the client kinds packages register. It types the handle side only, `intercepted.result` and `end({ result })`; in middleware hooks a client activity's result is `unknown`, even after narrowing on its kind, because the hook types accept every kind. An extension registers a kind by augmenting the published entry:
 *
 * ```ts
 * declare module '@prisma/orm-framework/components/runtime' {
 *   interface ClientActivityRegistry { 'orm-call': { result: unknown } }
 * }
 * ```
 */
export interface ClientActivityRegistry extends Record<never, never> {}

/** The result a client activity of kind `K` ends with: the registered type, or `unknown` for an unregistered kind. */
export type ClientActivityResult<K extends ClientActivityKind> =
  K extends keyof ClientActivityRegistry
    ? ClientActivityRegistry[K] extends { readonly result: infer R }
      ? R
      : unknown
    : unknown;

/** An act a client started through the runtime, such as an ORM call. */
export interface ClientActivity<K extends ClientActivityKind = ClientActivityKind>
  extends ActivityBase {
  readonly kind: K;
  /** An opaque digest of what the activity does, from the function the client supplied. It is computed on the first call and the same promise is returned to every later caller, so nothing is computed when no middleware asks. The client decides how fine the digest is, so equal digests do not mean equal work unless the client says so. */
  contentHash(): Promise<string>;
}

export type Activity = StatementActivity | TransactionActivity | ClientActivity;

/** What a client gives to start an activity. */
export interface StartActivity<K extends ClientActivityKind = ClientActivityKind> {
  readonly kind: K;
  /** Computes an opaque digest of what the activity does, as fine as the client chooses; say in the client's docs what equal digests mean. The runtime calls it at most once per activity, and only when a middleware asks for `activity.contentHash()`. */
  readonly contentHash: () => Promise<string>;
  readonly annotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;
}

/** How middleware treats a guardrail violation. `'strict'`, the default, makes `budgets` throw on every violation; `'permissive'` lets a violation whose severity is `'warn'` go to `log.warn`. */
export type RuntimeMode = 'strict' | 'permissive';

/**
 * The context of one activity. Every hook of the activity receives the same object.
 */
export interface ActivityContext {
  readonly contract: unknown;
  readonly mode: RuntimeMode;
  readonly now: () => number;
  readonly log: RuntimeLog;
  /**
   * A stable digest of an execution's storage hash, statement and parameters, usable directly as a `Map` key. Two equivalent executions return the same string.
   */
  contentHash(exec: ExecutionPlan): Promise<string>;
  /** The caller's cancellation signal, when it passed one. */
  readonly signal?: AbortSignal;
  /** The scope of the queryable the activity was started on. */
  readonly scope: 'runtime' | 'connection' | 'transaction';
  /** The parent activity's context, or `undefined` at the root. */
  readonly parent: ActivityContext | undefined;
  /** The state object stored under `key` for this activity, created empty on first use and dropped when the activity is finalized. Middleware that use the same key share the object. */
  state(key: string | symbol): Record<string | symbol, unknown>;
  /** Whether any ancestor of this activity is a transaction. */
  inTransaction(): boolean;
}

/** The fields a runtime supplies to build an activity's context; the runtime adds `parent`, `state` and `inTransaction`. */
export type ActivityContextFields<TContext extends ActivityContext = ActivityContext> = Omit<
  TContext,
  'parent' | 'state' | 'inTransaction'
>;

export interface TransactionEnded {
  readonly kind: 'transaction';
  readonly outcome: 'succeeded' | 'failed';
}

export type StatementEnded = {
  readonly kind: 'statement';
  /** `stopped` when the caller stopped reading the rows. */
  readonly outcome: 'succeeded' | 'failed' | 'stopped';
  readonly latencyMs: number;
  /** `middleware` when an `intercept` handler supplied the result, or threw. */
  readonly source: 'driver' | 'middleware';
} & (
  | { readonly returns: 'rows'; readonly rowCount: number }
  | { readonly returns: 'stats'; readonly stats?: RuntimeStatementStats }
);

export interface ClientActivityEnded<K extends ClientActivityKind = ClientActivityKind> {
  readonly kind: K;
  readonly outcome: 'succeeded' | 'failed' | 'stopped';
  /** `middleware` when an `intercept.onActivity` handler supplied the result and the client passed none, or when the handler threw. */
  readonly source: 'client' | 'middleware';
  /** The value the client returns to its caller. The runtime does not read it. */
  readonly result?: ClientActivityResult<K>;
}

export type ActivityEndedResult = TransactionEnded | StatementEnded | ClientActivityEnded;

export interface ActivityFinalizedResult {
  /** `unknown` when the runtime cannot tell whether the writes landed; treat it like `committed` when a committed write must not be missed. */
  readonly outcome: 'committed' | 'rolled-back' | 'unknown';
}

export interface QueryInterceptResult {
  readonly rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>;
}

export interface ActivityInterceptResult {
  readonly result: unknown;
}

export interface ExecuteInterceptResult {
  readonly stats: RuntimeStatementStats;
}

/**
 * Marker for the family-specific parameter mutator passed to `beforeEncode`. SQL extends it as `SqlParamRefMutator`, Mongo as `MongoParamRefMutator`.
 */
declare const PARAM_REF_MUTATOR_BRAND: unique symbol;
export type ParamRefMutator = { readonly [PARAM_REF_MUTATOR_BRAND]?: never };

/** The lifecycle events every activity has. They observe; they cannot change the activity. */
export interface ActivityObserver {
  readonly name: string;
  /** The act begins. */
  activityStarted?(activity: Activity, ctx: ActivityContext): Promise<void>;
  /** The act ends, with its outcome as the actor saw it. An error thrown when the activity succeeded fails it and reaches the caller; after a failure it is swallowed. */
  activityEnded?(
    activity: Activity,
    result: ActivityEndedResult,
    ctx: ActivityContext,
  ): Promise<void>;
  /** The act's effects are final. A thrown error is passed to `ctx.log.error` and swallowed; later middleware still run. */
  activityFinalized?(
    activity: Activity,
    result: ActivityFinalizedResult,
    ctx: ActivityContext,
  ): Promise<void>;
}

/**
 * Family-agnostic middleware. `TPlan` is the encoded execution plan the statement interceptors receive; `TMutator` is the family's parameter mutator.
 */
export interface RuntimeMiddleware<
  TPlan extends QueryPlan = QueryPlan,
  TMutator extends ParamRefMutator = ParamRefMutator,
> extends ActivityObserver {
  readonly familyId?: string;
  readonly targetId?: string;
  /** Runs after lowering, before codecs encode the parameter values. Throw to block the statement; change values through `params`. */
  beforeEncode?(draft: TPlan, ctx: ActivityContext, params?: TMutator): void | Promise<void>;
  /** Supplies a statement's result instead of running it. Middleware run in registration order and the first handler that returns a result wins. */
  intercept?: {
    onQuery?(plan: TPlan, ctx: ActivityContext): Promise<QueryInterceptResult | undefined>;
    onExecute?(plan: TPlan, ctx: ActivityContext): Promise<ExecuteInterceptResult | undefined>;
    /** Supplies the result of an activity a client started, after its `activityStarted` hooks. The client checks what it receives. */
    onActivity?(
      activity: ClientActivity,
      ctx: ActivityContext,
    ): Promise<ActivityInterceptResult | undefined>;
  };
  /** Runs for each row the driver returns; not for intercepted rows. Throw to stop the stream. */
  onRow?(row: Record<string, unknown>, plan: TPlan, ctx: ActivityContext): Promise<void>;
}

/**
 * Middleware that names no family or target, so it fits any family runtime's middleware array.
 */
export type CrossFamilyMiddleware<TPlan extends QueryPlan = QueryPlan> =
  RuntimeMiddleware<TPlan> & {
    readonly familyId?: undefined;
    readonly targetId?: undefined;
  };

/** Per-operation options accepted by every family runtime. */
export interface RuntimeExecuteOptions {
  readonly signal?: AbortSignal;
  readonly scope?: 'runtime' | 'connection' | 'transaction';
}

export interface RuntimeStatementStats {
  readonly affectedRows: number;
}

/** Any runtime that can query or execute plans and be shut down. */
export interface RuntimeExecutor<TPlan extends QueryPlan> {
  query<Row>(
    plan: TPlan & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
  execute(plan: TPlan, options?: RuntimeExecuteOptions): Promise<RuntimeStatementStats>;
  close(): Promise<void>;
}

export function checkMiddlewareCompatibility(
  middleware: RuntimeMiddleware,
  runtimeFamilyId: string,
  runtimeTargetId: string,
): void {
  if (middleware.targetId !== undefined && middleware.familyId === undefined) {
    throw runtimeError(
      'RUNTIME.MIDDLEWARE_INCOMPATIBLE',
      `Middleware '${middleware.name}' specifies targetId '${middleware.targetId}' without familyId`,
      { middleware: middleware.name, targetId: middleware.targetId },
    );
  }

  if (middleware.familyId !== undefined && middleware.familyId !== runtimeFamilyId) {
    throw runtimeError(
      'RUNTIME.MIDDLEWARE_FAMILY_MISMATCH',
      `Middleware '${middleware.name}' requires family '${middleware.familyId}' but the runtime is configured for family '${runtimeFamilyId}'`,
      { middleware: middleware.name, middlewareFamilyId: middleware.familyId, runtimeFamilyId },
    );
  }

  if (middleware.targetId !== undefined && middleware.targetId !== runtimeTargetId) {
    throw runtimeError(
      'RUNTIME.MIDDLEWARE_TARGET_MISMATCH',
      `Middleware '${middleware.name}' requires target '${middleware.targetId}' but the runtime is configured for target '${runtimeTargetId}'`,
      { middleware: middleware.name, middlewareTargetId: middleware.targetId, runtimeTargetId },
    );
  }
}

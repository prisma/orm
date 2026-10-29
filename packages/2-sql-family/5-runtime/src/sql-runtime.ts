import type { Contract } from '@internal/contract/types';
import {
  type ActivityContextFields,
  type ActivityParent,
  AsyncIterableResult,
  type ClientActivityEnd,
  type ClientActivityKind,
  type ClientActivityRun,
  checkAborted,
  checkMiddlewareCompatibility,
  createContextBeneath,
  executeStatement,
  type QueryPlan,
  RuntimeCore,
  type RuntimeExecuteOptions,
  type RuntimeLog,
  type RuntimeMode,
  runtimeError,
  type StartActivity,
  type StatementActivityRun,
  startClientActivity,
  startTransactionActivity,
  streamStatement,
  type TransactionActivityRun,
} from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  Adapter,
  AnyQueryAst,
  ContractCodecRegistry,
  LoweredStatement,
  PreparedExecuteRequest,
  SqlCodecCallContext,
  SqlConnection,
  SqlDriver,
  SqlQueryable,
  SqlStatementStats,
  SqlTransaction,
} from '@internal/sql-relational-core/ast';
import { collectOrderedParamRefs } from '@internal/sql-relational-core/ast';
import type { CodecTypesBase } from '@internal/sql-relational-core/expression';
import {
  createSqlParamRefMutator,
  type SqlParamRefMutator,
  type SqlParamRefMutatorInternal,
} from '@internal/sql-relational-core/middleware';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import type { RuntimeScope, SqlOrmPlan } from '@internal/sql-relational-core/types';
import { invariant } from '@internal/utils/assertions';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type StructuredError, structuredError } from '@internal/utils/structured-error';
import {
  type ActivityExecuteOptions,
  type ActivityHandle,
  type ActivitySource,
  type ActivitySourceTarget,
  activitySource,
  type BoundPreparedStatement,
  type HashablePlan,
  planContentHashOn,
  startActivityOn,
} from './activity-handle';
import {
  buildDecodeContext,
  type DecodeContext,
  decodeRow,
  type ListDecoder,
  sqlNativeArrayListDecoder,
} from './codecs/decoding';
import { deriveParamMetadata, encodeParams, encodeParamsWithMetadata } from './codecs/encoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';
import { computeSqlContentHash } from './content-hash';
import { computeSqlFingerprint } from './fingerprint';
import { InFlightOperations } from './in-flight-operations';
import { lowerSqlPlan } from './lower-sql-plan';
import { runBeforeCompileChain } from './middleware/before-compile-chain';
import type { SqlMiddleware, SqlMiddlewareContext } from './middleware/sql-middleware';
import { beginOwnedTransaction } from './owned-transaction';
import { buildBindSiteParams } from './prepared/bind-site-params';
import { encodePreparedParams, resolvePreparedSlotValues } from './prepared/encode-prepared';
import {
  type PreparedStatementExecuteTarget,
  preparedStatementExecute,
  runPreparedExecute,
} from './prepared/prepared-execute';
import {
  type PreparedStatementQueryTarget,
  preparedStatementQuery,
  runPreparedQuery,
} from './prepared/prepared-query';
import {
  PreparedExecutionImpl,
  PreparedStatementImpl,
  type PreparedStatementInternals,
} from './prepared/prepared-statement';
import type {
  Declaration,
  ParamsFromDeclaration,
  PrepareCallback,
  PreparedExecution,
  PreparedFor,
  PreparedStatement,
} from './prepared/types';
import type {
  RuntimeFamilyAdapter,
  RuntimeTelemetryEvent,
  TelemetryOutcome,
  VerifyMarkerOption,
} from './runtime-spi';
import type { ExecutionContext } from './sql-context';
import { SqlFamilyAdapter } from './sql-family-adapter';
import {
  createTransactionStart,
  type SettledTransactionTarget,
  settlementOf,
  type TransactionStartTarget,
  transactionSettlement,
  transactionStart,
  wasRefusedBeforeBegin,
} from './transaction-state';

export type Log = RuntimeLog;

/**
 * When `close()` starts refusing new runtime-scope work. `'when-idle'` (the default) waits until the runtime has been idle for one turn of the event loop, so work that keeps it busy from the close onward is admitted; use it for an owner with one caller, such as a per-request connection. `'at-once'` refuses from the call of `close()`; use it for an owner that many callers share. Both wait for work already in flight, and an activity already open when `close()` is called, such as an ORM call, finishes its work: its statements, its transaction and the activities started beneath it are admitted until it ends.
 */
export type CloseRefusal = 'when-idle' | 'at-once';

export interface RuntimeOptions<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver<unknown>;
  readonly verifyMarker?: VerifyMarkerOption;
  readonly middleware?: readonly SqlMiddleware[];
  readonly mode?: RuntimeMode;
  readonly log?: Log;
  readonly closeRefusal?: CloseRefusal | undefined;
  /** Whether `close()` closes the driver; `true` by default. Pass `false` for a runtime that shares a driver its owner closes: its `close()` refuses new work and waits for work in flight, and leaves the driver open. */
  readonly ownsDriver?: boolean | undefined;
}

/**
 * SQL-family runtime interface. Named `Runtime` (not `SqlRuntime`) by deliberate exception
 * to avoid a repo-wide rename; see ADR 230 (runtime target layer) for the recorded decision.
 */
export interface Runtime extends RuntimeQueryable {
  connection(): Promise<RuntimeConnection>;
  telemetry(): RuntimeTelemetryEvent | null;
  /**
   * Waits until the runtime has been idle for one turn of the event loop, with no database work in flight and none started since, then closes the driver, unless the runtime was built with `ownsDriver: false`. Runtime-scope work that starts after that, opening a connection included, is refused with `DRIVER.NOT_CONNECTED`. Work on a held connection or transaction is never refused. A statement in flight and a transaction from its start until its commit or rollback settles are work `close()` waits for; a connection held between statements is not, and the driver's close waits for its release. Every call returns the same promise.
   */
  close(): Promise<void>;

  /**
   * Build a reusable {@link PreparedStatement}. Throws
   * `RUNTIME.PREPARE_UNUSED_PARAM` if any declared name is unreferenced
   * by the callback's plan.
   */
  prepare<D extends Declaration<CT>, Row, CT extends CodecTypesBase = CodecTypesBase>(
    declaration: D,
    callback: PrepareCallback<D, Row>,
  ): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>>;
}

export interface RuntimeConnection extends RuntimeQueryable {
  transaction(): Promise<RuntimeTransaction>;
  /**
   * Returns the connection to the pool for reuse. Only call this when the connection is known to be in a clean state. If a transaction commit/rollback failed or the connection is otherwise suspect, call `destroy(reason)` instead.
   */
  release(): Promise<void>;
  /**
   * Evicts the connection so it is never reused. Call this when the connection may be in an indeterminate state (e.g. a failed rollback leaving an open transaction, or a broken socket).
   *
   * If teardown fails the error is propagated and the connection remains retryable, so the caller can decide whether to swallow the failure or retry cleanup. Calling destroy() or release() more than once after a successful teardown is caller error.
   *
   * `reason` is advisory context only. It may be surfaced to driver-level observability hooks (e.g. pg-pool's `'release'` event) but does not influence eviction behavior and is not rethrown.
   */
  destroy(reason?: unknown): Promise<void>;
}

export interface RuntimeTransaction extends RuntimeQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface RuntimeQueryable extends RuntimeScope {}

export interface TransactionContext extends RuntimeQueryable {
  readonly invalidated: boolean;
}

export type { RuntimeTelemetryEvent, TelemetryOutcome, VerifyMarkerOption };

type SqlStatementActivityRun = StatementActivityRun<
  SqlExecutionPlan,
  SqlParamRefMutator,
  SqlMiddlewareContext
>;

/**
 * The route a client activity's statements and transaction take to the database. A subclass whose statements run on its own sessions, such as role sessions, builds one and starts activities on it with `startActivityOnRoute`.
 */
export interface ActivityRoute {
  readonly scope: 'runtime' | 'connection' | 'transaction';
  /** The parent of an activity started on the route itself. */
  parent(): ActivityParent | undefined;
  query<Row>(plan: SqlOrmPlan<Row>, options: ActivityExecuteOptions): AsyncIterableResult<Row>;
  execute(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    options: ActivityExecuteOptions,
  ): Promise<SqlStatementStats>;
  preparedQuery<Params, Row>(
    statement: PreparedStatementImpl<Params, Row>,
    params: Params,
    options: ActivityExecuteOptions,
  ): AsyncIterableResult<Row>;
  preparedExecute<Params>(
    statement: PreparedExecutionImpl<Params>,
    params: Params,
    options: ActivityExecuteOptions,
  ): Promise<SqlStatementStats>;
  /** Begins a transaction beneath `parent`; absent where the route is a transaction. */
  readonly transaction: ((parent: ActivityParent) => Promise<RuntimeTransaction>) | undefined;
  /** Whether an open activity on the route is runtime work that `close()` waits for. */
  readonly runtimeWork: boolean;
}

function isExecutionPlan(plan: SqlExecutionPlan | SqlQueryPlan): plan is SqlExecutionPlan {
  return 'sql' in plan;
}

function isBoundPreparedStatement(subject: HashablePlan): subject is BoundPreparedStatement {
  return 'statement' in subject;
}

function isPreparedStatementInternals(
  statement: BoundPreparedStatement['statement'],
): statement is BoundPreparedStatement['statement'] & PreparedStatementInternals {
  return statement instanceof PreparedStatementImpl || statement instanceof PreparedExecutionImpl;
}

// v8 ignore next 2
const noopLogSink = (): void => {};
const noopLog: Log = { info: noopLogSink, warn: noopLogSink, error: noopLogSink };
// Taken when the module loads, so close() still settles when a test installs fake timers later.
const scheduleTimer = globalThis.setTimeout;

function runtimeClosedError(): StructuredError {
  return structuredError('DRIVER.NOT_CONNECTED', 'Runtime is closed', {
    why: 'close() was called on this runtime, or on the client or connection that owns it. An await using scope calls close() when it ends.',
    fix: 'Await every query, transaction and prepared statement before close(). The usual cause is a query returned without await from an await using scope.',
  });
}

/**
 * Abstract family-layer base for SQL runtimes. Subclass to build a target runtime
 * (e.g. `PostgresRuntimeImpl`); app code should consume the `Runtime` interface returned
 * by the target factories, never this class directly.
 */
export abstract class SqlRuntimeBase<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>
  extends RuntimeCore<SqlQueryPlan, SqlExecutionPlan, SqlMiddleware>
  implements Runtime
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  private readonly driver: SqlDriver<unknown>;
  private readonly familyAdapter: RuntimeFamilyAdapter<Contract<SqlStorage>>;
  private readonly contractCodecs: ContractCodecRegistry;
  private readonly codecDescriptors: CodecDescriptorRegistry;
  private readonly sqlCtx: ActivityContextFields<SqlMiddlewareContext>;
  private readonly verifyMarkerOption: VerifyMarkerOption;
  // Memoises the first verifyMarker() call so concurrent first queries share one read and one log line, and is cleared when that read fails so the next query retries it. `null` until the first query; pre-resolved when `verifyMarkerOption === false`.
  private verifyMarkerPromise: Promise<void> | null;
  private closePromise: Promise<void> | null;
  private readonly ownsDriver: boolean;
  private readonly closeRefusal: CloseRefusal;
  readonly #inFlight = new InFlightOperations();
  // Transactions from their start until their commit or rollback settles. close() waits for them once it refuses, but an open transaction alone does not keep a 'when-idle' close from starting to refuse.
  readonly #openTransactionWork = new InFlightOperations();
  // Ends the open-transaction record of the transaction most recently begun on each connection.
  readonly #transactionWorkOn = new WeakMap<SqlQueryable, () => void>();
  #openActivityHandles = 0;
  #refusing = false;
  // Connections and transactions this runtime handed out. When the first query of the runtime runs on one of them, the runtime-wide marker read runs on it too, so it works while close() waits for their release, and concurrent first queries share its result. Other queryables, such as a subclass's raw connection, read the marker through the driver.
  readonly #heldQueryables = new WeakSet<SqlQueryable>();
  readonly #preparedStatementHandles = new WeakMap<object, unknown>();
  // Each open transaction this runtime began, keyed by its driver transaction and its connection, until its commit() or rollback() is called. A statement sent on either is the transaction's child.
  // Decided once when the runtime is created: a transaction keeps its finished statements to finalize them only when some middleware implements activityFinalized.
  readonly #holdFinishedChildren: boolean;
  readonly #openTransactions = new WeakMap<
    SqlQueryable,
    TransactionActivityRun<SqlMiddlewareContext>
  >();
  private codecRegistryValidated: boolean;
  private _telemetry: RuntimeTelemetryEvent | null;

  constructor(options: RuntimeOptions<TContract>) {
    const {
      context,
      adapter,
      driver,
      verifyMarker,
      middleware,
      mode,
      log,
      closeRefusal,
      ownsDriver,
    } = options;

    if (middleware) {
      for (const mw of middleware) {
        checkMiddlewareCompatibility(mw, 'sql', context.contract.target);
      }
    }

    const sqlCtx: ActivityContextFields<SqlMiddlewareContext> = {
      contract: context.contract,
      mode: mode ?? 'strict',
      now: () => Date.now(),
      log: log ?? noopLog,
      // ctx is only invoked by operation-specific middleware runner with execs this runtime lowered; the framework parameter type is the cross-family base.
      contentHash: (exec) =>
        computeSqlContentHash(
          blindCast<
            SqlExecutionPlan,
            'SQL operation middleware receives lowered SQL execution plans'
          >(exec),
        ),
      scope: 'runtime',
    };

    super({ middleware: middleware ?? [], ctx: sqlCtx });
    this.#holdFinishedChildren = this.middleware.some((mw) => mw.activityFinalized !== undefined);

    this.contract = context.contract;
    this.adapter = adapter;
    this.driver = driver;
    this.familyAdapter = new SqlFamilyAdapter(context.contract, adapter.profile);
    this.contractCodecs = context.contractCodecs;
    this.codecDescriptors = context.codecDescriptors;
    this.sqlCtx = sqlCtx;
    this.verifyMarkerOption = verifyMarker ?? 'onFirstUse';
    this.closeRefusal = closeRefusal ?? 'when-idle';
    this.codecRegistryValidated = false;
    this.verifyMarkerPromise = this.verifyMarkerOption === false ? Promise.resolve() : null;
    this.closePromise = null;
    this.ownsDriver = ownsDriver ?? true;
    this._telemetry = null;
  }

  /**
   * Lower a `SqlQueryPlan` (AST + meta) into a `SqlExecutionPlan`
   * with encoded parameters ready for the driver.
   *
   * Implementation note: SQL splits lower-then-encode across
   * {@link lowerToDraft} + {@link encodeDraftParams} so the selected
   * operation's middleware chain can run between them:
   * {@link prepareOperation} runs the statement's `beforeEncode` chain
   * between them (cipherstash bulk-encrypt, for example, mutates pre-encode
   * `ParamRef.value` slots). This protected hook composes the two back into
   * the cross-family `lower()` shape `RuntimeCore` expects. The production
   * operation methods use the matching split form before driver execution.
   *
   * `ctx: SqlCodecCallContext` is forwarded to `encodeParams` so
   * per-query cancellation reaches every codec body during parameter
   * encoding. SQL params do not populate `ctx.column` — encode-side
   * column metadata is the middleware's domain.
   */
  protected override async lower(
    plan: SqlQueryPlan,
    ctx: SqlCodecCallContext,
  ): Promise<SqlExecutionPlan> {
    const draft = this.lowerToDraft(plan);
    return await this.encodeDraftParams(draft, ctx);
  }

  /**
   * AST → pre-encode draft for the selected `query()` or `execute()` operation.
   * The returned plan has `sql` rendered and `params` populated with the
   * user-domain values the lowering site collected from `ParamRef` nodes. No
   * codec encode has happened yet; consumers can mutate `params` via the
   * `SqlParamRefMutator` before {@link encodeDraftParams} runs.
   */
  private lowerToDraft(plan: SqlQueryPlan): SqlExecutionPlan {
    return lowerSqlPlan(this.adapter, this.contract, plan);
  }

  /**
   * Encode a draft plan's params for the selected `query()` or `execute()`
   * operation through the per-column codecs and freeze the result into the
   * final `SqlExecutionPlan` the driver sees. Errors surface as
   * `RUNTIME.ENCODE_FAILED` envelopes from {@link encodeParams}.
   */
  private async encodeDraftParams(
    draft: SqlExecutionPlan,
    ctx: SqlCodecCallContext,
  ): Promise<SqlExecutionPlan> {
    return Object.freeze({
      ...draft,
      params: await encodeParams(draft, ctx, this.contractCodecs),
    });
  }

  /** Default query invocation required by the abstract `RuntimeCore` contract. */
  // v8 ignore next 6
  protected override runDriver(exec: SqlExecutionPlan): AsyncIterable<Record<string, unknown>> {
    return this.driver.query<Record<string, unknown>>({
      sql: exec.sql,
      params: exec.params,
    });
  }

  protected override runExecute(exec: SqlExecutionPlan): Promise<SqlStatementStats> {
    return this.driver.execute({ sql: exec.sql, params: exec.params });
  }

  /**
   * Runs the registered middleware `beforeCompile` chain over the plan's draft (AST + meta). Returns the original plan unchanged when no middleware rewrote the AST; otherwise returns a new plan carrying the rewritten AST and meta. The lowering adapter and the encoder both walk the rewritten AST directly.
   */
  private async compilePlan(
    plan: SqlQueryPlan,
    middlewareCtx: SqlMiddlewareContext,
  ): Promise<SqlQueryPlan> {
    const rewrittenDraft = await runBeforeCompileChain(
      this.middleware,
      { ast: plan.ast, meta: plan.meta },
      middlewareCtx,
    );
    return rewrittenDraft.ast === plan.ast
      ? plan
      : { ...plan, ast: rewrittenDraft.ast, meta: rewrittenDraft.meta };
  }

  override query<Row>(
    plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.queryAgainstQueryable<Row>(plan, this.driver, options);
  }

  override execute(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    return this.executeStatisticsAgainstQueryable(plan, this.driver, options);
  }

  [preparedStatementQuery]<Params, Row>(
    ps: PreparedStatement<Params, Row>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.runPreparedQueryAgainstQueryable<Params, Row>(
      blindCast<
        PreparedStatementImpl<Params, Row>,
        'prepared statements are created by this runtime implementation'
      >(ps),
      params,
      this.driver,
      options,
    );
  }

  [preparedStatementExecute]<Params>(
    ps: PreparedExecution<Params>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    return this.runPreparedExecuteAgainstQueryable<Params>(
      blindCast<
        PreparedExecutionImpl<Params>,
        'prepared statements are created by this runtime implementation'
      >(ps),
      params,
      this.driver,
      options,
    );
  }

  #runtimeRoute: ActivityRoute | undefined;

  readonly [activitySource]: ActivitySource = {
    startActivity: <K extends ClientActivityKind>(
      activity: StartActivity<K>,
    ): Promise<ActivityHandle<K>> => {
      this.#runtimeRoute ??= this.queryableRoute(this.driver, 'runtime', () => undefined, {
        transaction: (parent) => this.beginOwnedTransactionBeneath(parent),
        runtimeWork: true,
      });
      return this.startActivityOnRoute(this.#runtimeRoute, activity, undefined);
    },
    planContentHash: (plan: HashablePlan): Promise<string> =>
      this.planContentHashFor(plan, 'runtime', undefined),
  };

  /**
   * Starts a client activity whose statements and transaction run on `route`, beneath `parent` or, without one, beneath `route.parent()`.
   */
  protected startActivityOnRoute<K extends ClientActivityKind>(
    route: ActivityRoute,
    activity: StartActivity<K>,
    parent: ActivityParent | undefined,
  ): Promise<ActivityHandle<K>> {
    let endWork: () => void = noWork;
    let started: Promise<ClientActivityRun<K, SqlMiddlewareContext>>;
    try {
      endWork = route.runtimeWork ? this.beginActivityWork(parent) : noWork;
      started = startClientActivity<K, SqlMiddlewareContext>(activity, {
        middleware: this.middleware,
        context: route.scope === 'runtime' ? this.sqlCtx : { ...this.sqlCtx, scope: route.scope },
        parent: parent ?? route.parent(),
        holdFinishedChildren: this.#holdFinishedChildren,
      });
    } catch (error) {
      endWork();
      return Promise.reject(error);
    }
    return started.then(
      (run) => this.activityHandle(run, route, endWork),
      (error: unknown) => {
        endWork();
        throw error;
      },
    );
  }

  /** The content hash of the statement `plan` would send on a queryable of `scope` beneath `parent`. */
  protected async planContentHashFor(
    plan: HashablePlan,
    scope: ActivityRoute['scope'],
    parent: ActivityParent | undefined,
  ): Promise<string> {
    this.ensureCodecRegistryValidated();
    if (isBoundPreparedStatement(plan)) {
      const { statement, params } = plan;
      invariant(
        isPreparedStatementInternals(statement),
        'The prepared statement was not prepared by a SQL runtime',
      );
      return computeSqlContentHash({
        sql: statement.sql,
        ast: statement.ast,
        meta: statement.meta,
        params: await encodePreparedParams(statement, params, {}, this.contractCodecs),
      });
    }
    if (isExecutionPlan(plan)) {
      return computeSqlContentHash(
        Object.freeze({ ...plan, params: await encodeParams(plan, {}, this.contractCodecs) }),
      );
    }
    const compiled = await this.compilePlan(
      plan,
      createContextBeneath<SqlMiddlewareContext>({ ...this.sqlCtx, scope }, parent),
    );
    return computeSqlContentHash(await this.encodeDraftParams(this.lowerToDraft(compiled), {}));
  }

  /** An activity route whose statements run on `queryable`. */
  protected queryableRoute(
    queryable: SqlQueryable,
    scope: ActivityRoute['scope'],
    parent: () => ActivityParent | undefined,
    options: Pick<ActivityRoute, 'transaction' | 'runtimeWork'>,
  ): ActivityRoute {
    return {
      scope,
      parent,
      ...options,
      query: <Row>(plan: SqlOrmPlan<Row>, executeOptions: ActivityExecuteOptions) =>
        this.queryAgainstQueryable<Row>(plan, queryable, { ...executeOptions, scope }),
      execute: (plan, executeOptions) =>
        this.executeStatisticsAgainstQueryable(plan, queryable, { ...executeOptions, scope }),
      preparedQuery: <Params, Row>(
        statement: PreparedStatementImpl<Params, Row>,
        params: Params,
        executeOptions: ActivityExecuteOptions,
      ) =>
        this.runPreparedQueryAgainstQueryable<Params, Row>(statement, params, queryable, {
          ...executeOptions,
          scope,
        }),
      preparedExecute: <Params>(
        statement: PreparedExecutionImpl<Params>,
        params: Params,
        executeOptions: ActivityExecuteOptions,
      ) =>
        this.runPreparedExecuteAgainstQueryable<Params>(statement, params, queryable, {
          ...executeOptions,
          scope,
        }),
    };
  }

  /** The activity route of a held connection that `owner` wraps: its statements run on `connection`, and its transactions begin there. */
  protected connectionRoute(
    connection: SqlConnection,
    owner: TransactionStartTarget,
  ): ActivityRoute {
    const openTransaction = this.#openTransactions.get(connection);
    return this.queryableRoute(connection, 'connection', () => openTransaction, {
      transaction:
        openTransaction === undefined
          ? (parent) => this.beginTransactionBeneathOn(connection, owner, parent)
          : undefined,
      runtimeWork: false,
    });
  }

  // A connection runs one transaction at a time; a second one would send BEGIN inside the first.
  private beginTransactionBeneathOn(
    connection: SqlConnection,
    owner: TransactionStartTarget,
    parent: ActivityParent,
  ): Promise<RuntimeTransaction> {
    const openTransaction = this.#openTransactions.get(connection);
    if (openTransaction !== undefined) {
      return Promise.reject(transactionAlreadyOpenError(parent, openTransaction));
    }
    return this.beginTransactionOn(connection, owner, parent);
  }

  /** The `activitySource` member of a held connection that `owner()` wraps. */
  protected connectionActivitySource(
    connection: SqlConnection,
    owner: () => TransactionStartTarget,
  ): ActivitySource {
    return {
      startActivity: <K extends ClientActivityKind>(
        activity: StartActivity<K>,
      ): Promise<ActivityHandle<K>> =>
        this.startActivityOnRoute(this.connectionRoute(connection, owner()), activity, undefined),
      planContentHash: (plan: HashablePlan): Promise<string> =>
        this.planContentHashFor(plan, 'connection', this.#openTransactions.get(connection)),
    };
  }

  // Every member is the handle's own, so a wrapper that spreads the handle keeps them all.
  private activityHandle<K extends ClientActivityKind>(
    run: ClientActivityRun<K, SqlMiddlewareContext>,
    route: ActivityRoute,
    endWork: () => void,
  ): ActivityHandle<K> {
    const beneath = (options: RuntimeExecuteOptions | undefined): ActivityExecuteOptions => ({
      ...options,
      activityParent: run,
    });
    const source: ActivitySource = {
      startActivity: <Nested extends ClientActivityKind>(
        activity: StartActivity<Nested>,
      ): Promise<ActivityHandle<Nested>> => {
        try {
          run.assertAcceptsChildren();
        } catch (error) {
          return Promise.reject(error);
        }
        return this.startActivityOnRoute(route, activity, run);
      },
      planContentHash: (plan: HashablePlan): Promise<string> =>
        this.planContentHashFor(plan, route.scope, run),
    };
    const handle: ActivityHandle<K> &
      PreparedStatementQueryTarget &
      PreparedStatementExecuteTarget = {
      [activitySource]: source,
      startActivity: source.startActivity,
      planContentHash: source.planContentHash,
      activity: run.activity,
      get intercepted() {
        return run.intercepted;
      },
      query<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return rowsBeneath(run, () => route.query<Row>(plan, beneath(options)));
      },
      async execute(
        plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        run.assertAcceptsChildren();
        return route.execute(plan, beneath(options));
      },
      [preparedStatementQuery]<Params, Row>(
        ps: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return rowsBeneath(run, () =>
          route.preparedQuery<Params, Row>(
            blindCast<
              PreparedStatementImpl<Params, Row>,
              'prepared statements are created by this runtime implementation'
            >(ps),
            params,
            beneath(options),
          ),
        );
      },
      async [preparedStatementExecute]<Params>(
        ps: PreparedExecution<Params>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        run.assertAcceptsChildren();
        return route.preparedExecute<Params>(
          blindCast<
            PreparedExecutionImpl<Params>,
            'prepared statements are created by this runtime implementation'
          >(ps),
          params,
          beneath(options),
        );
      },
      end(end: ClientActivityEnd<K>): Promise<void> {
        let ending: Promise<void>;
        try {
          ending = run.end(end);
        } catch (error) {
          endWork();
          return Promise.reject(error);
        }
        return ending.then(endWork, (error: unknown) => {
          endWork();
          throw error;
        });
      },
    };
    const beginTransaction = route.transaction;
    if (beginTransaction === undefined) return handle;
    return Object.assign(handle, {
      transaction: async (): Promise<RuntimeTransaction> => {
        run.assertAcceptsChildren();
        return beginTransaction(run);
      },
    });
  }

  // A transaction beneath an activity on the runtime takes a connection of its own and gives it back when it settles.
  private async beginOwnedTransactionBeneath(parent: ActivityParent): Promise<RuntimeTransaction> {
    const { driverConnection, connection } = await this.openConnection({ activityParent: parent });
    return this.ownTransaction(connection, () =>
      this.beginTransactionOn(driverConnection, connection, parent),
    );
  }

  /** Begins a transaction with `begin` on a connection the transaction owns; see `beginOwnedTransaction`. */
  protected ownTransaction(
    connection: Pick<RuntimeConnection, 'release' | 'destroy'>,
    begin: () => Promise<RuntimeTransaction>,
  ): Promise<RuntimeTransaction> {
    return beginOwnedTransaction(connection, begin, this.sqlCtx.log);
  }

  /**
   * Returns a raw driver connection. SQL issued on it runs below the middleware/codec/telemetry pipeline. It carries its own lifecycle (`release`/`destroy`/`beginTransaction`); the caller owns disposal. It follows the runtime's close rule for connections: see {@link Runtime.close}. Pass the `activityParent` of the activity it is acquired for, so it is admitted after `close()` while that activity is open.
   */
  protected async acquireRawConnection(
    options?: Pick<ActivityExecuteOptions, 'activityParent'>,
  ): Promise<SqlConnection> {
    const endOperation = this.beginOperation(this.driver, options);
    let connection: SqlConnection;
    try {
      connection = await this.driver.acquireConnection();
    } finally {
      endOperation();
    }
    // A transaction still open when its connection is released or destroyed can no longer settle, so close() stops waiting for it.
    const dispose = async (teardown: () => Promise<void>): Promise<void> => {
      try {
        await this.#inFlight.track(teardown);
      } finally {
        this.#transactionWorkOn.get(held)?.();
      }
    };
    const held: SqlConnection = {
      query: (request) => this.trackRows(connection.query(request)),
      execute: (request) => this.#inFlight.track(() => connection.execute(request)),
      beginTransaction: () => connection.beginTransaction(),
      ...ifDefined('explain', connection.explain?.bind(connection)),
      release: () => dispose(() => connection.release()),
      destroy: (reason) => dispose(() => connection.destroy(reason)),
    };
    return held;
  }

  // A stream sent directly on a raw connection is work in flight from its first read until the driver answers it, as a statement the runtime streams is; one never read is not.
  private async *trackRows<Row>(rows: AsyncIterable<Row>): AsyncGenerator<Row, void, unknown> {
    const iterator = rows[Symbol.asyncIterator]();
    try {
      let next = await this.#inFlight.track(() => iterator.next());
      while (!next.done) {
        yield next.value;
        next = await iterator.next();
      }
    } finally {
      await iterator.return?.();
    }
  }

  private async setupDriverExecution(
    exec: SqlExecutionPlan,
    queryable: SqlQueryable,
  ): Promise<void> {
    this.familyAdapter.validatePlan(exec, this.contract);
    this._telemetry = null;
    if (this.verifyMarkerPromise === null) {
      const markerQueryable = this.#heldQueryables.has(queryable) ? queryable : this.driver;
      this.verifyMarkerPromise = this.verifyMarker(markerQueryable).catch((error: unknown) => {
        this.verifyMarkerPromise = null;
        throw error;
      });
    }
    await this.verifyMarkerPromise;
  }

  // An open activity handle on the runtime is runtime work in flight until its end().
  private beginActivityWork(parent: ActivityParent | undefined): () => void {
    const endOperation = this.beginOperation(this.driver, { activityParent: parent });
    this.#openActivityHandles++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#openActivityHandles--;
      endOperation();
    };
  }

  // A handle never ended, or a transaction left open, keeps close() waiting with no other trace, so close() says so once. openTransactions counts the transactions open at that moment, which close() waits for until they commit or roll back; they count only once close() refuses, because until then they do not hold it.
  private warnWhenWaitingOnlyForUnendedWork(warned: { done: boolean }): void {
    const openTransactions = this.#refusing ? this.#openTransactionWork.count : 0;
    if (warned.done || (this.#openActivityHandles === 0 && openTransactions === 0)) return;
    if (this.#inFlight.count !== this.#openActivityHandles) return;
    warned.done = true;
    this.sqlCtx.log.warn({
      event: 'runtime.close.waiting-for-activities',
      openActivities: this.#openActivityHandles,
      openTransactions,
    });
  }

  // Called synchronously when an operation enters the runtime; returns the callback that ends its in-flight record. Work on the driver is runtime-scope work and throws once refusal has begun, unless it belongs to an open activity, which was admitted when it started and keeps close() waiting until it ends. Work on any other queryable holds a connection, so it is never refused, but it is recorded, so the runtime counts as busy while it runs.
  private beginOperation(
    queryable: SqlQueryable,
    options?: Pick<ActivityExecuteOptions, 'activityParent'>,
  ): () => void {
    const admittedParent = options?.activityParent?.acceptsChildren() === true;
    if (queryable === this.driver && this.#refusing && !admittedParent) {
      throw runtimeClosedError();
    }
    return this.#inFlight.begin();
  }

  // A statement sent through an activity handle is the activity's child; one sent on an open transaction, or on its connection, is the transaction's.
  private parentOf(
    queryable: SqlQueryable,
    options: ActivityExecuteOptions | undefined,
  ): ActivityParent | undefined {
    const openTransaction = this.#openTransactions.get(queryable);
    const activityParent = options?.activityParent;
    if (activityParent === undefined) return openTransaction;
    if (openTransaction !== undefined && !activityParent.ctx.inTransaction()) {
      throw activityOutsideTransactionError(activityParent, openTransaction);
    }
    return activityParent;
  }

  protected getListDecoder(): ListDecoder {
    return sqlNativeArrayListDecoder;
  }

  private async *streamDecodedRows<Row>(
    run: SqlStatementActivityRun,
    exec: SqlExecutionPlan,
    createDecodeContext: () => DecodeContext,
    driverCall: () => AsyncIterable<Record<string, unknown>>,
    codecCtx: SqlCodecCallContext,
    queryable: SqlQueryable,
    onDriverAnswered: () => void,
  ): AsyncGenerator<Row, void, unknown> {
    const rowDecodeContext = createDecodeContext();
    await this.setupDriverExecution(exec, queryable);

    const startedAt = Date.now();
    let telemetryOutcome: TelemetryOutcome | null = null;

    try {
      const stream = run.runQuery(exec, driverCall);

      // Manually drive the driver's async iterator so the between-row
      // abort check fires *before* requesting the next row. With a
      // `for await...of` loop the runtime would await `iterator.next()`
      // first, leaving a window where one extra row is pulled through
      // the driver after the signal aborted.
      const iterator = stream[Symbol.asyncIterator]();
      let answered = false;
      try {
        while (true) {
          checkAborted(codecCtx, 'stream');
          const next = answered
            ? await iterator.next()
            : await iterator.next().finally(onDriverAnswered);
          answered = true;
          if (next.done) break;
          const decodedRow = await decodeRow(
            next.value,
            rowDecodeContext,
            codecCtx,
            this.getListDecoder(),
          );
          yield blindCast<Row, 'decoded SQL rows match the query plan result type'>(decodedRow);
        }
      } finally {
        // Best-effort iterator cleanup so the driver can release its
        // resources whether the stream finished normally, threw, or was
        // abandoned by the consumer.
        await iterator.return?.();
      }

      telemetryOutcome = 'success';
    } catch (error) {
      telemetryOutcome = 'runtime-error';
      throw error;
    } finally {
      if (telemetryOutcome !== null) {
        this.recordTelemetry(exec, telemetryOutcome, Date.now() - startedAt);
      }
    }
  }

  private createQueryContexts(options: RuntimeExecuteOptions | undefined): {
    readonly codecCtx: SqlCodecCallContext;
    readonly contextFields: ActivityContextFields<SqlMiddlewareContext>;
  } {
    const signal = options?.signal;
    const scope = options?.scope ?? 'runtime';
    const codecCtx: SqlCodecCallContext = signal === undefined ? {} : { signal };
    const contextFields: ActivityContextFields<SqlMiddlewareContext> = {
      ...this.sqlCtx,
      ...ifDefined('signal', signal),
      ...(scope !== 'runtime' ? { scope } : {}),
    };
    return { codecCtx, contextFields };
  }

  private async prepareOperation(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    codecCtx: SqlCodecCallContext,
    run: SqlStatementActivityRun,
  ): Promise<SqlExecutionPlan> {
    checkAborted(codecCtx, 'stream');

    if (isExecutionPlan(plan)) {
      const mutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(plan);
      await run.beforeEncode(plan, mutator);
      return Object.freeze({
        ...plan,
        params: await encodeParams(
          { ...plan, params: mutator.currentParams() },
          codecCtx,
          this.contractCodecs,
        ),
      });
    }

    const compiled = await this.compilePlan(plan, run.ctx);
    const draft = this.lowerToDraft(compiled);
    const mutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(draft);
    await run.beforeEncode(draft, mutator);
    const draftWithMutations: SqlExecutionPlan = Object.freeze({
      ...draft,
      params: mutator.currentParams(),
    });
    return this.encodeDraftParams(draftWithMutations, codecCtx);
  }

  /** Query rows against a caller-supplied queryable through the shared preparation pipeline. */
  protected queryAgainstQueryable<Row>(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    queryable: SqlQueryable,
    options?: ActivityExecuteOptions,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated();

    const self = this;
    const { codecCtx, contextFields } = this.createQueryContexts(options);
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const endOperation = self.beginOperation(queryable, options);
      try {
        yield* streamStatement(
          {
            middleware: self.middleware,
            plan,
            context: contextFields,
            parent: self.parentOf(queryable, options),
          },
          async function* (run: SqlStatementActivityRun): AsyncGenerator<Row, void, unknown> {
            const exec = await self.prepareOperation(plan, codecCtx, run);
            yield* self.streamDecodedRows<Row>(
              run,
              exec,
              () => buildDecodeContext(exec.ast, self.contractCodecs),
              () =>
                queryable.query<Record<string, unknown>>({ sql: exec.sql, params: exec.params }),
              codecCtx,
              queryable,
              endOperation,
            );
          },
        );
      } finally {
        endOperation();
      }
    };

    return new AsyncIterableResult(generator());
  }

  /** Execute statistics against a caller-supplied queryable through the shared preparation pipeline. */
  protected async executeStatisticsAgainstQueryable(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    queryable: SqlQueryable,
    options?: ActivityExecuteOptions,
  ): Promise<SqlStatementStats> {
    const endOperation = this.beginOperation(queryable, options);
    try {
      return await this.executeStatisticsInFlight(plan, queryable, options);
    } finally {
      endOperation();
    }
  }

  private async executeStatisticsInFlight(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    queryable: SqlQueryable,
    options: ActivityExecuteOptions | undefined,
  ): Promise<SqlStatementStats> {
    this.ensureCodecRegistryValidated();

    const { codecCtx, contextFields } = this.createQueryContexts(options);
    return this.executeOn(queryable, options, plan, contextFields, async (run) => {
      const exec = await this.prepareOperation(plan, codecCtx, run);
      return this.executeEncodedPlan(run, exec, queryable, codecCtx, () =>
        queryable.execute({ sql: exec.sql, params: exec.params }),
      );
    });
  }

  private executeOn(
    queryable: SqlQueryable,
    options: ActivityExecuteOptions | undefined,
    plan: QueryPlan,
    context: ActivityContextFields<SqlMiddlewareContext>,
    body: (run: SqlStatementActivityRun) => Promise<SqlStatementStats>,
  ): Promise<SqlStatementStats> {
    return executeStatement(
      { middleware: this.middleware, plan, context, parent: this.parentOf(queryable, options) },
      body,
    );
  }

  private async executeEncodedPlan(
    run: SqlStatementActivityRun,
    exec: SqlExecutionPlan,
    queryable: SqlQueryable,
    codecCtx: SqlCodecCallContext,
    driverCall: () => Promise<SqlStatementStats>,
  ): Promise<SqlStatementStats> {
    await this.setupDriverExecution(exec, queryable);
    checkAborted(codecCtx, 'stream');

    const startedAt = Date.now();
    let telemetryOutcome: TelemetryOutcome = 'success';
    try {
      return await run.runExecute(exec, driverCall);
    } catch (error) {
      telemetryOutcome = 'runtime-error';
      throw error;
    } finally {
      this.recordTelemetry(exec, telemetryOutcome, Date.now() - startedAt);
    }
  }

  async prepare<D extends Declaration<CT>, Row, CT extends CodecTypesBase = CodecTypesBase>(
    declaration: D,
    callback: PrepareCallback<D, Row>,
  ): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>> {
    this.ensureCodecRegistryValidated();

    const bindSiteParams = buildBindSiteParams(declaration);

    const userPlan = callback(bindSiteParams);
    const finalPlan = await this.compilePlan(
      userPlan,
      createContextBeneath<SqlMiddlewareContext>(this.sqlCtx, undefined),
    );

    const orderedRefs = collectOrderedParamRefs(finalPlan.ast);

    // Type-level detection isn't achievable across chained-builder generics.
    const referencedNames = new Set<string>();
    for (const ref of orderedRefs) {
      if (ref.kind === 'prepared-param-ref') referencedNames.add(ref.name);
    }
    const missing = Object.keys(declaration).filter((name) => !referencedNames.has(name));
    if (missing.length > 0) {
      throw runtimeError(
        'RUNTIME.PREPARE_UNUSED_PARAM',
        `Prepared statement declaration includes parameter${missing.length === 1 ? '' : 's'} not referenced by the callback's plan: ${missing.join(', ')}`,
        { unused: missing },
      );
    }

    const lowered = this.adapter.lower(finalPlan.ast, {
      contract: this.contract,
      params: orderedRefs.map((r) => (r.kind === 'param-ref' ? r.value : undefined)),
    });

    const decodeContext = buildDecodeContext(finalPlan.ast, this.contractCodecs);
    const paramMetadata = deriveParamMetadata(finalPlan.ast);

    const internals: PreparedStatementInternals = Object.freeze({
      sql: lowered.sql,
      ast: finalPlan.ast,
      meta: finalPlan.meta,
      slots: lowered.params,
      decodeContext,
      paramMetadata,
    });

    // The plan's declared result picks the handle: a statement reporting an
    // affected-row count prepares into one that executes, everything else into
    // one that streams rows. The cast carries that runtime choice into the
    // conditional type `PreparedFor` states for the caller.
    const prepared =
      finalPlan.ast.kind === 'raw-query' && finalPlan.ast.result.kind === 'affected-count'
        ? new PreparedExecutionImpl<ParamsFromDeclaration<D, CT>>(internals)
        : new PreparedStatementImpl<ParamsFromDeclaration<D, CT>, Row>(internals);

    return blindCast<
      PreparedFor<ParamsFromDeclaration<D, CT>, Row>,
      "the plan's declared result decides the handle, and PreparedFor states that same choice in the type"
    >(prepared);
  }

  /** Query prepared rows against a caller-supplied queryable through the full pipeline. */
  protected runPreparedQueryAgainstQueryable<P, Row>(
    ps: PreparedStatementImpl<P, Row>,
    userParams: unknown,
    queryable: SqlQueryable,
    options?: ActivityExecuteOptions,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated();

    const self = this;
    const { codecCtx, contextFields } = this.createQueryContexts(options);

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const endOperation = self.beginOperation(queryable, options);
      try {
        yield* streamStatement(
          {
            middleware: self.middleware,
            plan: ps,
            context: contextFields,
            parent: self.parentOf(queryable, options),
          },
          (run: SqlStatementActivityRun) =>
            self.streamPreparedRows<P, Row>(run, ps, userParams, queryable, codecCtx, endOperation),
        );
      } finally {
        endOperation();
      }
    };

    return new AsyncIterableResult(generator());
  }

  private async *streamPreparedRows<P, Row>(
    run: SqlStatementActivityRun,
    ps: PreparedStatementImpl<P, Row>,
    userParams: unknown,
    queryable: SqlQueryable,
    codecCtx: SqlCodecCallContext,
    onDriverAnswered: () => void,
  ): AsyncGenerator<Row, void, unknown> {
    checkAborted(codecCtx, 'stream');

    // Resolve slot order to unencoded values so `beforeEncode`'s
    // mutator sees pre-encode user values for prepared-param slots
    // and can override them before encode runs.
    const preEncodeValues = resolvePreparedSlotValues(ps, userParams);
    const preEncodeExec: SqlExecutionPlan = {
      sql: ps.sql,
      params: preEncodeValues,
      ast: ps.ast,
      meta: ps.meta,
    };

    const mutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(preEncodeExec);
    await run.beforeEncode(preEncodeExec, mutator);

    const encodedParams = await encodeParamsWithMetadata(
      mutator.currentParams(),
      ps.paramMetadata,
      codecCtx,
      this.contractCodecs,
    );
    const exec: SqlExecutionPlan = {
      sql: ps.sql,
      params: encodedParams,
      ast: ps.ast,
      meta: ps.meta,
    };

    const handles = this.#preparedStatementHandles;
    const request: PreparedExecuteRequest = {
      sql: exec.sql,
      params: exec.params,
      preparedStatementHandle: {
        get: () => handles.get(ps),
        set: (value) => {
          handles.set(ps, value);
        },
      },
    };

    yield* this.streamDecodedRows<Row>(
      run,
      exec,
      () => ps.decodeContext,
      () => queryable.query<Record<string, unknown>>(request),
      codecCtx,
      queryable,
      onDriverAnswered,
    );
  }

  /** Execute a prepared statement's statistics against a caller-supplied queryable through the full pipeline. */
  protected async runPreparedExecuteAgainstQueryable<P>(
    ps: PreparedExecutionImpl<P>,
    userParams: unknown,
    queryable: SqlQueryable,
    options?: ActivityExecuteOptions,
  ): Promise<SqlStatementStats> {
    const endOperation = this.beginOperation(queryable, options);
    try {
      return await this.runPreparedExecuteInFlight(ps, userParams, queryable, options);
    } finally {
      endOperation();
    }
  }

  private async runPreparedExecuteInFlight<P>(
    ps: PreparedExecutionImpl<P>,
    userParams: unknown,
    queryable: SqlQueryable,
    options: ActivityExecuteOptions | undefined,
  ): Promise<SqlStatementStats> {
    this.ensureCodecRegistryValidated();

    const { codecCtx, contextFields } = this.createQueryContexts(options);
    return this.executeOn(queryable, options, ps, contextFields, (run) =>
      this.executePrepared(run, ps, userParams, queryable, codecCtx),
    );
  }

  private async executePrepared<P>(
    run: SqlStatementActivityRun,
    ps: PreparedExecutionImpl<P>,
    userParams: unknown,
    queryable: SqlQueryable,
    codecCtx: SqlCodecCallContext,
  ): Promise<SqlStatementStats> {
    checkAborted(codecCtx, 'stream');

    // Slot order resolves to unencoded values first so `beforeEncode`'s
    // mutator sees pre-encode user values and can override them before encode
    // runs — the same split the ad-hoc execute path takes.
    const preEncodeValues = resolvePreparedSlotValues(ps, userParams);
    const preEncodeExec: SqlExecutionPlan = {
      sql: ps.sql,
      params: preEncodeValues,
      ast: ps.ast,
      meta: ps.meta,
    };

    const mutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(preEncodeExec);
    await run.beforeEncode(preEncodeExec, mutator);

    const exec: SqlExecutionPlan = {
      sql: ps.sql,
      params: await encodeParamsWithMetadata(
        mutator.currentParams(),
        ps.paramMetadata,
        codecCtx,
        this.contractCodecs,
      ),
      ast: ps.ast,
      meta: ps.meta,
    };
    const handles = this.#preparedStatementHandles;
    const request: PreparedExecuteRequest = {
      sql: exec.sql,
      params: exec.params,
      preparedStatementHandle: {
        get: () => handles.get(ps),
        set: (value) => {
          handles.set(ps, value);
        },
      },
    };

    return this.executeEncodedPlan(run, exec, queryable, codecCtx, () =>
      queryable.execute(request),
    );
  }

  async connection(): Promise<RuntimeConnection> {
    return (await this.openConnection()).connection;
  }

  private async openConnection(options?: Pick<ActivityExecuteOptions, 'activityParent'>): Promise<{
    readonly driverConnection: SqlConnection;
    readonly connection: RuntimeConnection & TransactionStartTarget;
  }> {
    const driverConn = await this.acquireRawConnection(options);
    this.#heldQueryables.add(driverConn);
    const self = this;

    const wrappedConnection: RuntimeConnection &
      TransactionStartTarget &
      ActivitySourceTarget &
      PreparedStatementQueryTarget &
      PreparedStatementExecuteTarget = {
      [transactionStart]: createTransactionStart(),
      transaction(): Promise<RuntimeTransaction> {
        return self.beginTransactionOn(driverConn, wrappedConnection, undefined);
      },
      [activitySource]: self.connectionActivitySource(driverConn, () => wrappedConnection),
      release: () => driverConn.release(),
      destroy: (reason?: unknown) => driverConn.destroy(reason),
      query<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.queryAgainstQueryable<Row>(plan, driverConn, {
          ...options,
          scope: 'connection',
        });
      },
      execute(
        plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.executeStatisticsAgainstQueryable(plan, driverConn, {
          ...options,
          scope: 'connection',
        });
      },
      [preparedStatementQuery]<Params, Row>(
        ps: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.runPreparedQueryAgainstQueryable<Params, Row>(
          blindCast<
            PreparedStatementImpl<Params, Row>,
            'prepared statements are created by this runtime implementation'
          >(ps),
          params,
          driverConn,
          { ...options, scope: 'connection' },
        );
      },
      [preparedStatementExecute]<Params>(
        ps: PreparedExecution<Params>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.runPreparedExecuteAgainstQueryable<Params>(
          blindCast<
            PreparedExecutionImpl<Params>,
            'prepared statements are created by this runtime implementation'
          >(ps),
          params,
          driverConn,
          { ...options, scope: 'connection' },
        );
      },
    };

    return { driverConnection: driverConn, connection: wrappedConnection };
  }

  /**
   * Begins a transaction on `connection`, which `owner` wraps, as a transaction activity. When the transaction's `activityStarted` hooks refuse the start, no `BEGIN` is sent, `owner` is recorded as clean, and `withTransaction` releases it; after any other start failure it destroys it. The transaction's `activityStarted` hooks run before `BEGIN`. Every statement sent on the transaction, or on `connection`, from the end of `BEGIN` until `commit()` or `rollback()` is called is the transaction's child, and is finalized when the transaction ends, with its outcome. `commit()` and `rollback()` resolve after every finalization hook has run. A subclass that holds its own connection begins its transactions here.
   */
  protected async beginTransactionOn(
    connection: SqlConnection,
    owner: TransactionStartTarget,
    parent: ActivityParent | undefined,
  ): Promise<RuntimeTransaction> {
    owner[transactionStart].refusedBeforeBegin = false;
    const endTransactionWork = this.#openTransactionWork.begin();
    this.#transactionWorkOn.set(connection, endTransactionWork);
    let activity: TransactionActivityRun<SqlMiddlewareContext>;
    try {
      activity = await startTransactionActivity<SqlMiddlewareContext>({
        middleware: this.middleware,
        context: { ...this.sqlCtx, scope: 'transaction' },
        parent,
        holdFinishedChildren: this.#holdFinishedChildren,
      });
    } catch (error) {
      endTransactionWork();
      owner[transactionStart].refusedBeforeBegin = true;
      throw error;
    }
    let driverTx: SqlTransaction;
    try {
      driverTx = await connection.beginTransaction();
    } catch (error) {
      endTransactionWork();
      await activity.end({ by: 'rollback', outcome: 'failed', commitAttempted: false });
      throw error;
    }
    if (this.#heldQueryables.has(connection)) this.#heldQueryables.add(driverTx);
    return this.wrapTransaction(driverTx, connection, activity, endTransactionWork);
  }

  private wrapTransaction(
    driverTx: SqlTransaction,
    connection: SqlConnection,
    activity: TransactionActivityRun<SqlMiddlewareContext>,
    endTransactionWork: () => void,
  ): RuntimeTransaction {
    this.#openTransactions.set(driverTx, activity);
    this.#openTransactions.set(connection, activity);
    // A statement sent after commit() or rollback() is called reaches the database after the COMMIT or ROLLBACK (see SqlTransaction), so it is no longer the transaction's child.
    const stopAcceptingChildren = (): void => {
      activity.stopAcceptingChildren();
      for (const queryable of [driverTx, connection]) {
        if (this.#openTransactions.get(queryable) === activity) {
          this.#openTransactions.delete(queryable);
        }
      }
    };
    let commitAttempted = false;
    const settlement = {
      committed: false,
      rolledBack: false,
      logDroppedError(error: unknown): void {
        try {
          activity.ctx.log.error({ event: 'middleware.activityEnded.error', error });
        } catch {
          // A failing logger must not replace the error the caller receives.
        }
      },
    };
    let commitEnding: Promise<void> | undefined;
    const self = this;
    const wrappedTransaction: RuntimeTransaction &
      SettledTransactionTarget &
      ActivitySourceTarget &
      PreparedStatementQueryTarget &
      PreparedStatementExecuteTarget = {
      [transactionSettlement]: settlement,
      async commit(): Promise<void> {
        commitAttempted = true;
        stopAcceptingChildren();
        try {
          await self.#inFlight.track(() => driverTx.commit());
        } catch (error) {
          endTransactionWork();
          await activity.end({ by: 'commit', outcome: 'failed' });
          throw error;
        }
        settlement.committed = true;
        commitEnding = activity.end({ by: 'commit', outcome: 'succeeded' });
        try {
          await commitEnding;
        } finally {
          endTransactionWork();
        }
      },
      async rollback(): Promise<void> {
        stopAcceptingChildren();
        if (settlement.committed) {
          await commitEnding?.catch(() => undefined);
          return;
        }
        if (settlement.rolledBack) return;
        try {
          await self.#inFlight.track(() => driverTx.rollback());
        } catch (error) {
          endTransactionWork();
          await activity.end({ by: 'rollback', outcome: 'failed', commitAttempted });
          throw error;
        }
        settlement.rolledBack = true;
        try {
          await activity.end({ by: 'rollback', outcome: 'succeeded', commitAttempted });
        } finally {
          endTransactionWork();
        }
      },
      [activitySource]: {
        startActivity: <K extends ClientActivityKind>(
          clientActivity: StartActivity<K>,
        ): Promise<ActivityHandle<K>> =>
          self.startActivityOnRoute(
            self.queryableRoute(driverTx, 'transaction', () => activity, {
              transaction: undefined,
              runtimeWork: false,
            }),
            clientActivity,
            undefined,
          ),
        planContentHash: (plan: HashablePlan): Promise<string> =>
          self.planContentHashFor(plan, 'transaction', activity),
      },
      query<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.queryAgainstQueryable<Row>(plan, driverTx, {
          ...options,
          scope: 'transaction',
        });
      },
      execute(
        plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.executeStatisticsAgainstQueryable(plan, driverTx, {
          ...options,
          scope: 'transaction',
        });
      },
      [preparedStatementQuery]<Params, Row>(
        ps: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.runPreparedQueryAgainstQueryable<Params, Row>(
          blindCast<
            PreparedStatementImpl<Params, Row>,
            'prepared statements are created by this runtime implementation'
          >(ps),
          params,
          driverTx,
          { ...options, scope: 'transaction' },
        );
      },
      [preparedStatementExecute]<Params>(
        ps: PreparedExecution<Params>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        return self.runPreparedExecuteAgainstQueryable<Params>(
          blindCast<
            PreparedExecutionImpl<Params>,
            'prepared statements are created by this runtime implementation'
          >(ps),
          params,
          driverTx,
          { ...options, scope: 'transaction' },
        );
      },
    };
    return wrappedTransaction;
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this._telemetry;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeDriverAfterWork();
    return this.closePromise;
  }

  private async closeDriverAfterWork(): Promise<void> {
    await this.refuseAfterWork();
    if (this.ownsDriver) await this.driver.close();
  }

  // With 'when-idle', refusal begins once the runtime has been idle for one turn of the event loop (a setTimeout(0)): no database work in flight, and none started since the timer was set. A chain of dependent queries that keeps the runtime busy from the close onward, such as an ORM write and its reload, is admitted to its end. With 'at-once', close() has already started refusing.
  // With 'at-once' nothing is awaited before the refusal flag is set, so it is set inside the call of close().
  private async refuseAfterWork(): Promise<void> {
    const warned = { done: false };
    if (this.closeRefusal === 'when-idle') {
      await this.waitForIdleTurn(warned);
    }
    this.#refusing = true;
    this.warnWhenWaitingOnlyForUnendedWork(warned);
    while (this.#inFlight.active || this.#openTransactionWork.active) {
      await this.#inFlight.drained();
      this.warnWhenWaitingOnlyForUnendedWork(warned);
      await this.#openTransactionWork.drained();
    }
  }

  private async waitForIdleTurn(warned: { done: boolean }): Promise<void> {
    for (;;) {
      const startedBefore = this.#inFlight.started;
      await new Promise<void>((resolve) => scheduleTimer(resolve, 0));
      if (!this.#inFlight.active && this.#inFlight.started === startedBefore) {
        return;
      }
      this.warnWhenWaitingOnlyForUnendedWork(warned);
      await this.#inFlight.drained();
    }
  }

  private ensureCodecRegistryValidated(): void {
    if (!this.codecRegistryValidated) {
      validateCodecRegistryCompleteness(this.codecDescriptors, this.contract);
      this.codecRegistryValidated = true;
    }
  }

  private async verifyMarker(queryable: SqlQueryable): Promise<void> {
    const readResult = await this.familyAdapter.markerReader.readMarker(queryable);

    const expectedStorageHash = this.contract.storage.storageHash;
    const expectedProfileHash = this.contract.profileHash ?? null;
    const expected = { storageHash: expectedStorageHash, profileHash: expectedProfileHash };

    if (readResult.kind !== 'present') {
      this.sqlCtx.log.warn({
        code: 'CONTRACT.MARKER_MISSING',
        scope: 'marker-verification',
        expected,
        actual: null,
        message: 'Contract marker not found in database',
      });
      return;
    }

    const marker = readResult.record;
    const storageHashMatch = marker.storageHash === expectedStorageHash;
    const profileHashMatch =
      expectedProfileHash === null || marker.profileHash === expectedProfileHash;

    if (!storageHashMatch || !profileHashMatch) {
      this.sqlCtx.log.warn({
        code: 'CONTRACT.MARKER_MISMATCH',
        scope: 'marker-verification',
        expected,
        actual: { storageHash: marker.storageHash, profileHash: marker.profileHash ?? null },
        message: 'Contract marker hash does not match runtime contract',
      });
    }
  }

  private recordTelemetry(
    plan: SqlExecutionPlan,
    outcome: TelemetryOutcome,
    durationMs?: number,
  ): void {
    const contract = this.contract;
    this._telemetry = Object.freeze({
      lane: plan.meta.lane,
      target: contract.target,
      fingerprint: computeSqlFingerprint(plan.sql),
      outcome,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }
}

function activityOutsideTransactionError(
  parent: ActivityParent,
  openTransaction: ActivityParent,
): Error {
  return runtimeError(
    'RUNTIME.ACTIVITY_OUTSIDE_TRANSACTION',
    `Work was sent through a '${parent.activity.kind}' activity onto a connection whose open transaction the activity is not part of. Start the activity on the transaction instead.`,
    {
      kind: parent.activity.kind,
      id: parent.activity.id,
      transactionId: openTransaction.activity.id,
    },
  );
}

function transactionAlreadyOpenError(
  parent: ActivityParent,
  openTransaction: ActivityParent,
): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_ALREADY_OPEN',
    `A transaction is already open on this connection; a '${parent.activity.kind}' activity cannot begin another until it commits or rolls back.`,
    {
      kind: parent.activity.kind,
      id: parent.activity.id,
      transactionId: openTransaction.activity.id,
    },
  );
}

// Rows of a handle's statement, refused at the first read when the handle no longer accepts children, before the route takes a connection or session.
function noWork(): void {}

function rowsBeneath<Row>(
  run: ClientActivityRun<ClientActivityKind, SqlMiddlewareContext>,
  rows: () => AsyncIterable<Row>,
): AsyncIterableResult<Row> {
  return new AsyncIterableResult(new RowsBeneath(run, rows));
}

/** The rows of a statement started beneath `run`, checked against `run` on the first `next()`. It forwards to the statement's own iterator rather than adding an async generator, so each row costs no extra turn. */
class RowsBeneath<Row> implements AsyncGenerator<Row, void, unknown> {
  readonly #run: ClientActivityRun<ClientActivityKind, SqlMiddlewareContext>;
  readonly #rows: () => AsyncIterable<Row>;
  #inner: AsyncIterator<Row, void, unknown> | undefined;
  #done = false;

  constructor(
    run: ClientActivityRun<ClientActivityKind, SqlMiddlewareContext>,
    rows: () => AsyncIterable<Row>,
  ) {
    this.#run = run;
    this.#rows = rows;
  }

  next(): Promise<IteratorResult<Row, void>> {
    if (this.#done) return Promise.resolve({ done: true, value: undefined });
    if (this.#inner === undefined) {
      try {
        this.#run.assertAcceptsChildren();
        this.#inner = this.#rows()[Symbol.asyncIterator]();
      } catch (error) {
        this.#done = true;
        return Promise.reject(error);
      }
    }
    return this.#inner.next();
  }

  return(): Promise<IteratorResult<Row, void>> {
    const inner = this.#inner;
    this.#done = true;
    return inner?.return === undefined
      ? Promise.resolve({ done: true, value: undefined })
      : inner.return();
  }

  throw(error: unknown): Promise<IteratorResult<Row, void>> {
    const inner = this.#inner;
    if (inner?.throw === undefined) {
      this.#done = true;
      return Promise.reject(error);
    }
    return inner.throw(error);
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.return();
  }
}

function transactionClosedError(): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_CLOSED',
    'Cannot use a transaction operation after the transaction has ended. Consume query results and await execute calls inside the transaction callback.',
    {},
  );
}

/**
 * Minimal structural type `withTransaction` depends on — anything that can open a connection. A connection the runtime made also carries its last transaction start, and its transactions carry their settlement; `withTransaction` reads both to decide whether a failure left the connection clean and which error to report.
 */
export interface ConnectionProvider {
  connection(): Promise<RuntimeConnection & Partial<TransactionStartTarget>>;
}

/**
 * Adds a client's members to the context `withTransaction` passes. The context is the prototype, not spread, so live accessors such as `invalidated` keep reading the transaction's state; spreading would copy their value once.
 */
export function withTransactionMembers<TMembers extends object>(
  txCtx: TransactionContext,
  members: TMembers,
): TransactionContext & TMembers {
  return Object.assign(castAs<TransactionContext>(Object.create(txCtx)), members);
}

export async function withTransaction<R>(
  runtime: ConnectionProvider,
  fn: (tx: TransactionContext) => PromiseLike<R>,
): Promise<R> {
  const connection = await runtime.connection();
  let transaction: RuntimeTransaction;
  try {
    transaction = await connection.transaction();
  } catch (error) {
    // A teardown error would mask the start error.
    if (wasRefusedBeforeBegin(connection)) {
      await connection.release().catch(() => undefined);
    } else {
      await connection.destroy(error).catch(() => undefined);
    }
    throw error;
  }

  let invalidated = false;

  async function* guardedStream<Row>(
    open: () => AsyncIterable<Row>,
  ): AsyncGenerator<Row, void, unknown> {
    if (invalidated) {
      throw transactionClosedError();
    }
    for await (const row of open()) {
      yield row;
      if (invalidated) {
        throw transactionClosedError();
      }
    }
  }

  function guardedQueryable(
    target: RuntimeScope,
  ): RuntimeScope & PreparedStatementQueryTarget & PreparedStatementExecuteTarget {
    return {
      query<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return new AsyncIterableResult(guardedStream(() => target.query<Row>(plan, options)));
      },
      async execute(
        plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        if (invalidated) throw transactionClosedError();
        return target.execute(plan, options);
      },
      [preparedStatementQuery]<Params, Row>(
        ps: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return new AsyncIterableResult(
          guardedStream(() => runPreparedQuery(target, ps, params, options)),
        );
      },
      async [preparedStatementExecute]<Params>(
        ps: PreparedExecution<Params>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): Promise<SqlStatementStats> {
        if (invalidated) throw transactionClosedError();
        return runPreparedExecute(target, ps, params, options);
      },
    };
  }

  function guardedSource(target: RuntimeScope): ActivitySource {
    return {
      async startActivity<K extends ClientActivityKind>(
        activity: StartActivity<K>,
      ): Promise<ActivityHandle<K>> {
        if (invalidated) throw transactionClosedError();
        return guardedHandle(await startActivityOn(target, activity));
      },
      planContentHash(plan: HashablePlan): Promise<string> {
        return planContentHashOn(target, plan);
      },
    };
  }

  function guardedHandle<K extends ClientActivityKind>(
    handle: ActivityHandle<K>,
  ): ActivityHandle<K> & PreparedStatementQueryTarget & PreparedStatementExecuteTarget {
    const source = guardedSource(handle);
    return {
      ...source,
      ...guardedQueryable(handle),
      [activitySource]: source,
      activity: handle.activity,
      get intercepted() {
        return handle.intercepted;
      },
      end: (end) => handle.end(end),
    };
  }

  const txContext: TransactionContext &
    PreparedStatementQueryTarget &
    PreparedStatementExecuteTarget &
    ActivitySourceTarget = {
    ...guardedQueryable(transaction),
    get invalidated() {
      return invalidated;
    },
    [activitySource]: guardedSource(transaction),
  };

  let connectionDisposed = false;
  const destroyConnection = async (reason: unknown): Promise<void> => {
    if (connectionDisposed) return;
    connectionDisposed = true;
    // SqlConnection.destroy() propagates teardown errors so callers can decide what to do with them. Here, we're already about to throw a more informative error describing why we're evicting the connection (rollback/commit failure), so swallowing the teardown error is the right call — surfacing it would mask the original cause.
    await connection.destroy(reason).catch(() => undefined);
  };

  try {
    let result: R;
    try {
      result = await fn(txContext);
    } catch (error) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        // The ROLLBACK landed and an activityEnded hook threw after it: the callback's error is the one to report, and the connection is clean.
        const settlement = settlementOf(transaction);
        if (settlement?.rolledBack === true) {
          settlement.logDroppedError(rollbackError);
          throw error;
        }
        await destroyConnection(rollbackError);
        const wrapped = runtimeError(
          'RUNTIME.TRANSACTION_ROLLBACK_FAILED',
          'Transaction rollback failed after callback error',
          { rollbackError },
        );
        wrapped.cause = error;
        throw wrapped;
      }
      throw error;
    } finally {
      invalidated = true;
    }

    try {
      await transaction.commit();
    } catch (commitError) {
      if (settlementOf(transaction)?.committed === true) throw commitError;
      // After a failed COMMIT the server-side transaction may be: (a) already committed (error on response path), (b) already rolled back (deferred constraint / serialization failure), or (c) still open (COMMIT never reached the server). Attempt a best-effort rollback to cover (c) and confirm the protocol is healthy.
      //
      // If rollback succeeds, the server is definitely no longer in a transaction (no-op in (a)/(b), real cleanup in (c)) and we've just proved the connection round-trips correctly — it's safe to return to the pool. If rollback fails, the connection state is ambiguous (broken socket, protocol desync, etc.) and we must destroy it.
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        const settlement = settlementOf(transaction);
        if (settlement?.rolledBack === true) settlement.logDroppedError(rollbackError);
        else await destroyConnection(commitError);
      }
      const wrapped = runtimeError(
        'RUNTIME.TRANSACTION_COMMIT_FAILED',
        'Transaction commit failed',
        { commitError },
      );
      wrapped.cause = commitError;
      throw wrapped;
    }
    return result;
  } finally {
    if (!connectionDisposed) {
      await connection.release();
    }
  }
}

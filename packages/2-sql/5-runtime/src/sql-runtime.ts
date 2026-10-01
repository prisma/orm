import type { Contract } from '@internal/contract/types';
import {
  AsyncIterableResult,
  checkAborted,
  checkMiddlewareCompatibility,
  RuntimeCore,
  type RuntimeExecuteOptions,
  type RuntimeLog,
  type RuntimeMiddlewareContext,
  runBeforeExecuteChain,
  runBeforeQueryChain,
  runExecuteWithMiddleware,
  runQueryWithMiddleware,
  runtimeError,
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
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type StructuredError, structuredError } from '@internal/utils/structured-error';
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
import { buildBindSiteParams } from './prepared/bind-site-params';
import { resolvePreparedSlotValues } from './prepared/encode-prepared';
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

export type Log = RuntimeLog;

/**
 * When `close()` starts refusing new runtime-scope work. `'when-idle'` (the default) waits until the runtime has been idle for one turn of the event loop, so work that keeps it busy from the close onward is admitted; use it for an owner with one caller, such as a per-request connection. `'at-once'` refuses from the call of `close()`; use it for an owner that many callers share. Both wait for work already in flight.
 */
export type CloseRefusal = 'when-idle' | 'at-once';

export interface RuntimeOptions<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver<unknown>;
  readonly verifyMarker?: VerifyMarkerOption;
  readonly middleware?: readonly SqlMiddleware[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
  readonly closeRefusal?: CloseRefusal | undefined;
}

/**
 * SQL-family runtime interface. Named `Runtime` (not `SqlRuntime`) by deliberate exception
 * to avoid a repo-wide rename; see ADR 230 (runtime target layer) for the recorded decision.
 */
export interface Runtime extends RuntimeQueryable {
  connection(): Promise<RuntimeConnection>;
  telemetry(): RuntimeTelemetryEvent | null;
  /**
   * Waits until the runtime has been idle for one turn of the event loop, with no database work in flight and none started since, then closes the driver. Runtime-scope work that starts after that is refused with `DRIVER.NOT_CONNECTED`. Work on a held connection or transaction is never refused; the driver's close waits for its release. Every call returns the same promise.
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

function isExecutionPlan(plan: SqlExecutionPlan | SqlQueryPlan): plan is SqlExecutionPlan {
  return 'sql' in plan;
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
  private readonly sqlCtx: SqlMiddlewareContext;
  private readonly verifyMarkerOption: VerifyMarkerOption;
  // Memoises the first verifyMarker() call so concurrent first queries share one read and one log line, and is cleared when that read fails so the next query retries it. `null` until the first query; pre-resolved when `verifyMarkerOption === false`.
  private verifyMarkerPromise: Promise<void> | null;
  private closePromise: Promise<void> | null;
  private readonly closeRefusal: CloseRefusal;
  readonly #inFlight = new InFlightOperations();
  #refusing = false;
  // Connections and transactions this runtime handed out. When the first query of the runtime runs on one of them, the runtime-wide marker read runs on it too, so it works while close() waits for their release, and concurrent first queries share its result. Other queryables, such as a subclass's raw connection, read the marker through the driver.
  readonly #heldQueryables = new WeakSet<SqlQueryable>();
  readonly #preparedStatementHandles = new WeakMap<object, unknown>();
  private codecRegistryValidated: boolean;
  private _telemetry: RuntimeTelemetryEvent | null;

  constructor(options: RuntimeOptions<TContract>) {
    const { context, adapter, driver, verifyMarker, middleware, mode, log, closeRefusal } = options;

    if (middleware) {
      for (const mw of middleware) {
        checkMiddlewareCompatibility(mw, 'sql', context.contract.target);
      }
    }

    const sqlCtx: SqlMiddlewareContext = {
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
      // Placeholder satisfying the required field on the cross-family base. The
      // stored ctx is a runtime-level template; `createQueryContexts` spreads it
      // and overrides `planExecutionId` with a fresh UUID. ADR 220.
      planExecutionId: '',
    };

    super({ middleware: middleware ?? [], ctx: sqlCtx });

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
    this._telemetry = null;
  }

  /**
   * Lower a `SqlQueryPlan` (AST + meta) into a `SqlExecutionPlan`
   * with encoded parameters ready for the driver.
   *
   * Implementation note: SQL splits lower-then-encode across
   * {@link lowerToDraft} + {@link encodeDraftParams} so the selected
   * operation's middleware chain can run between them:
   * {@link prepareQueryExecution} uses `runBeforeQueryChain` for `query()`,
   * while {@link prepareExecuteExecution} uses `runBeforeExecuteChain` for
   * `execute()` (cipherstash bulk-encrypt, for example, mutates pre-encode
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
   * SQL pre-compile hook. Runs the registered middleware `beforeCompile` chain over the plan's draft (AST + meta). Returns the original plan unchanged when no middleware rewrote the AST; otherwise returns a new plan carrying the rewritten AST and meta. The AST is the authoritative source of execution metadata, so a rewrite needs no sidecar reconciliation here — the lowering adapter and the encoder both walk the rewritten
   * AST directly.
   */
  protected override runBeforeCompile(plan: SqlQueryPlan): Promise<SqlQueryPlan> {
    return this.compilePlan(plan, this.sqlCtx);
  }

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

  /**
   * Returns the raw driver connection. The connection is a `SqlQueryable` — SQL
   * issued on it runs below the middleware/codec/telemetry pipeline. It carries
   * its own lifecycle (`release`/`destroy`/`beginTransaction`); the caller owns
   * disposal.
   */
  protected acquireRawConnection(): Promise<SqlConnection> {
    return this.driver.acquireConnection();
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

  // Called synchronously when an operation enters the runtime; returns the callback that ends its in-flight record. Work on the driver is runtime-scope work and throws once refusal has begun. Work on any other queryable holds a connection, so it is never refused, but it is recorded, so the runtime counts as busy while it runs.
  private beginOperation(queryable: SqlQueryable): () => void {
    if (queryable === this.driver && this.#refusing) {
      throw runtimeClosedError();
    }
    return this.#inFlight.begin();
  }

  protected getListDecoder(): ListDecoder {
    return sqlNativeArrayListDecoder;
  }

  private async *streamRows<Row>(
    exec: SqlExecutionPlan,
    decodeContext: DecodeContext,
    driverCall: () => AsyncIterable<Record<string, unknown>>,
    codecCtx: SqlCodecCallContext,
    execMiddlewareCtx: RuntimeMiddlewareContext,
    queryable: SqlQueryable,
    onDriverAnswered: () => void,
  ): AsyncGenerator<Row, void, unknown> {
    await this.setupDriverExecution(exec, queryable);

    const startedAt = Date.now();
    let outcome: TelemetryOutcome | null = null;

    try {
      const stream = runQueryWithMiddleware<SqlExecutionPlan, Record<string, unknown>>(
        exec,
        this.middleware,
        execMiddlewareCtx,
        driverCall,
      );

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
          if (next.done) {
            break;
          }
          const decodedRow = await decodeRow(
            next.value,
            decodeContext,
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

      outcome = 'success';
    } catch (error) {
      outcome = 'runtime-error';
      throw error;
    } finally {
      if (outcome !== null) {
        this.recordTelemetry(exec, outcome, Date.now() - startedAt);
      }
    }
  }

  private createQueryContexts(options: RuntimeExecuteOptions | undefined): {
    readonly codecCtx: SqlCodecCallContext;
    readonly middlewareCtx: SqlMiddlewareContext;
  } {
    const signal = options?.signal;
    const scope = options?.scope ?? 'runtime';
    const codecCtx: SqlCodecCallContext = signal === undefined ? {} : { signal };
    const middlewareCtx: SqlMiddlewareContext = {
      ...this.sqlCtx,
      ...ifDefined('signal', signal),
      ...(scope !== 'runtime' ? { scope } : {}),
      planExecutionId: crypto.randomUUID(),
    };
    return { codecCtx, middlewareCtx };
  }

  private prepareQueryExecution(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    codecCtx: SqlCodecCallContext,
    middlewareCtx: SqlMiddlewareContext,
  ): Promise<SqlExecutionPlan> {
    return this.prepareOperation(plan, codecCtx, middlewareCtx, runBeforeQueryChain);
  }

  private prepareExecuteExecution(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    codecCtx: SqlCodecCallContext,
    middlewareCtx: SqlMiddlewareContext,
  ): Promise<SqlExecutionPlan> {
    return this.prepareOperation(plan, codecCtx, middlewareCtx, runBeforeExecuteChain);
  }

  private async prepareOperation(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    codecCtx: SqlCodecCallContext,
    middlewareCtx: SqlMiddlewareContext,
    runBefore: (
      plan: SqlExecutionPlan,
      middleware: ReadonlyArray<SqlMiddleware>,
      ctx: RuntimeMiddlewareContext,
      mutator: SqlParamRefMutator,
    ) => Promise<void>,
  ): Promise<SqlExecutionPlan> {
    checkAborted(codecCtx, 'stream');

    if (isExecutionPlan(plan)) {
      const mutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(plan);
      await runBefore(plan, this.middleware, middlewareCtx, mutator);
      return Object.freeze({
        ...plan,
        params: await encodeParams(
          { ...plan, params: mutator.currentParams() },
          codecCtx,
          this.contractCodecs,
        ),
      });
    }

    const compiled = await this.compilePlan(plan, middlewareCtx);
    const draft = this.lowerToDraft(compiled);
    const mutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(draft);
    await runBefore(draft, this.middleware, middlewareCtx, mutator);
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
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated();

    const self = this;
    const { codecCtx, middlewareCtx } = this.createQueryContexts(options);
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const endOperation = self.beginOperation(queryable);
      try {
        const exec = await self.prepareQueryExecution(plan, codecCtx, middlewareCtx);
        const decodeContext = buildDecodeContext(exec.ast, self.contractCodecs);
        yield* self.streamRows<Row>(
          exec,
          decodeContext,
          () => queryable.query<Record<string, unknown>>({ sql: exec.sql, params: exec.params }),
          codecCtx,
          middlewareCtx,
          queryable,
          endOperation,
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
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    const endOperation = this.beginOperation(queryable);
    try {
      return await this.executeStatisticsInFlight(plan, queryable, options);
    } finally {
      endOperation();
    }
  }

  private async executeStatisticsInFlight(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    queryable: SqlQueryable,
    options: RuntimeExecuteOptions | undefined,
  ): Promise<SqlStatementStats> {
    this.ensureCodecRegistryValidated();

    const { codecCtx, middlewareCtx } = this.createQueryContexts(options);
    const exec = await this.prepareExecuteExecution(plan, codecCtx, middlewareCtx);
    await this.setupDriverExecution(exec, queryable);
    checkAborted(codecCtx, 'stream');

    const startedAt = Date.now();
    let outcome: TelemetryOutcome = 'success';
    try {
      return await runExecuteWithMiddleware(exec, this.middleware, middlewareCtx, () =>
        queryable.execute({ sql: exec.sql, params: exec.params }),
      );
    } catch (error) {
      outcome = 'runtime-error';
      throw error;
    } finally {
      this.recordTelemetry(exec, outcome, Date.now() - startedAt);
    }
  }

  async prepare<D extends Declaration<CT>, Row, CT extends CodecTypesBase = CodecTypesBase>(
    declaration: D,
    callback: PrepareCallback<D, Row>,
  ): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>> {
    this.ensureCodecRegistryValidated();

    const bindSiteParams = buildBindSiteParams(declaration);

    const userPlan = callback(bindSiteParams);
    const finalPlan = await this.runBeforeCompile(userPlan);

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
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated();

    const self = this;
    const { codecCtx, middlewareCtx: execMiddlewareCtx } = this.createQueryContexts(options);

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const endOperation = self.beginOperation(queryable);
      try {
        yield* self.streamPreparedRows<P, Row>(
          ps,
          userParams,
          queryable,
          codecCtx,
          execMiddlewareCtx,
          endOperation,
        );
      } finally {
        endOperation();
      }
    };

    return new AsyncIterableResult(generator());
  }

  private async *streamPreparedRows<P, Row>(
    ps: PreparedStatementImpl<P, Row>,
    userParams: unknown,
    queryable: SqlQueryable,
    codecCtx: SqlCodecCallContext,
    execMiddlewareCtx: SqlMiddlewareContext,
    onDriverAnswered: () => void,
  ): AsyncGenerator<Row, void, unknown> {
    checkAborted(codecCtx, 'stream');

    // Resolve slot order to unencoded values so `beforeExecute`'s
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
    await runBeforeQueryChain<SqlExecutionPlan, SqlParamRefMutator>(
      preEncodeExec,
      this.middleware,
      execMiddlewareCtx,
      mutator,
    );

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

    yield* this.streamRows<Row>(
      exec,
      ps.decodeContext,
      () => queryable.query<Record<string, unknown>>(request),
      codecCtx,
      execMiddlewareCtx,
      queryable,
      onDriverAnswered,
    );
  }

  /** Execute a prepared statement's statistics against a caller-supplied queryable through the full pipeline. */
  protected async runPreparedExecuteAgainstQueryable<P>(
    ps: PreparedExecutionImpl<P>,
    userParams: unknown,
    queryable: SqlQueryable,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats> {
    const endOperation = this.beginOperation(queryable);
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
    options: RuntimeExecuteOptions | undefined,
  ): Promise<SqlStatementStats> {
    this.ensureCodecRegistryValidated();

    const { codecCtx, middlewareCtx } = this.createQueryContexts(options);
    checkAborted(codecCtx, 'stream');

    // Slot order resolves to unencoded values first so `beforeExecute`'s
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
    await runBeforeExecuteChain<SqlExecutionPlan, SqlParamRefMutator>(
      preEncodeExec,
      this.middleware,
      middlewareCtx,
      mutator,
    );

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
    await this.setupDriverExecution(exec, queryable);
    checkAborted(codecCtx, 'stream');

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

    const startedAt = Date.now();
    let outcome: TelemetryOutcome = 'success';
    try {
      return await runExecuteWithMiddleware(exec, this.middleware, middlewareCtx, () =>
        queryable.execute(request),
      );
    } catch (error) {
      outcome = 'runtime-error';
      throw error;
    } finally {
      this.recordTelemetry(exec, outcome, Date.now() - startedAt);
    }
  }

  async connection(): Promise<RuntimeConnection> {
    const endOperation = this.beginOperation(this.driver);
    let driverConn: SqlConnection;
    try {
      driverConn = await this.driver.acquireConnection();
    } finally {
      endOperation();
    }
    this.#heldQueryables.add(driverConn);
    const self = this;

    const wrappedConnection: RuntimeConnection &
      PreparedStatementQueryTarget &
      PreparedStatementExecuteTarget = {
      async transaction(): Promise<RuntimeTransaction> {
        const driverTx = await self.#inFlight.track(() => driverConn.beginTransaction());
        return self.wrapTransaction(driverTx);
      },
      async release(): Promise<void> {
        await self.#inFlight.track(() => driverConn.release());
      },
      async destroy(reason?: unknown): Promise<void> {
        await self.#inFlight.track(() => driverConn.destroy(reason));
      },
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

    return wrappedConnection;
  }

  private wrapTransaction(driverTx: SqlTransaction): RuntimeTransaction {
    this.#heldQueryables.add(driverTx);
    const self = this;
    const wrappedTransaction: RuntimeTransaction &
      PreparedStatementQueryTarget &
      PreparedStatementExecuteTarget = {
      async commit(): Promise<void> {
        await self.#inFlight.track(() => driverTx.commit());
      },
      async rollback(): Promise<void> {
        await self.#inFlight.track(() => driverTx.rollback());
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

  // With 'when-idle', refusal begins once the runtime has been idle for one turn of the event loop (a setTimeout(0)): no database work in flight, and none started since the timer was set. A chain of dependent queries that keeps the runtime busy from the close onward, such as an ORM write and its reload, is admitted to its end. With 'at-once', close() has already started refusing.
  // With 'at-once' nothing is awaited before the refusal flag is set, so it is set inside the call of close().
  private async closeDriverAfterWork(): Promise<void> {
    if (this.closeRefusal === 'when-idle') {
      await this.waitForIdleTurn();
    }
    this.#refusing = true;
    await this.#inFlight.drained();
    await this.driver.close();
  }

  private async waitForIdleTurn(): Promise<void> {
    for (;;) {
      const startedBefore = this.#inFlight.started;
      await new Promise<void>((resolve) => scheduleTimer(resolve, 0));
      if (!this.#inFlight.active && this.#inFlight.started === startedBefore) {
        return;
      }
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

function transactionClosedError(): Error {
  return runtimeError(
    'RUNTIME.TRANSACTION_CLOSED',
    'Cannot use a transaction operation after the transaction has ended. Consume query results and await execute calls inside the transaction callback.',
    {},
  );
}

/** Minimal structural type `withTransaction` depends on — anything that can open a connection. */
export interface ConnectionProvider {
  connection(): Promise<RuntimeConnection>;
}

export async function withTransaction<R>(
  runtime: ConnectionProvider,
  fn: (tx: TransactionContext) => PromiseLike<R>,
): Promise<R> {
  const connection = await runtime.connection();
  const transaction = await connection.transaction();

  let invalidated = false;

  async function* guardedStream<Row>(
    inner: AsyncIterable<Row>,
  ): AsyncGenerator<Row, void, unknown> {
    if (invalidated) {
      throw transactionClosedError();
    }
    for await (const row of inner) {
      yield row;
      if (invalidated) {
        throw transactionClosedError();
      }
    }
  }

  const txContext: TransactionContext &
    PreparedStatementQueryTarget &
    PreparedStatementExecuteTarget = {
    get invalidated() {
      return invalidated;
    },
    query<Row>(
      plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
      options?: RuntimeExecuteOptions,
    ): AsyncIterableResult<Row> {
      if (invalidated) {
        throw transactionClosedError();
      }
      return new AsyncIterableResult(guardedStream(transaction.query<Row>(plan, options)));
    },
    async execute(
      plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
      options?: RuntimeExecuteOptions,
    ): Promise<SqlStatementStats> {
      if (invalidated) {
        throw transactionClosedError();
      }
      return transaction.execute(plan, options);
    },
    [preparedStatementQuery]<Params, Row>(
      ps: PreparedStatement<Params, Row>,
      params: Params,
      options?: RuntimeExecuteOptions,
    ): AsyncIterableResult<Row> {
      if (invalidated) {
        throw transactionClosedError();
      }
      return new AsyncIterableResult(
        guardedStream(runPreparedQuery(transaction, ps, params, options)),
      );
    },
    [preparedStatementExecute]<Params>(
      ps: PreparedExecution<Params>,
      params: Params,
      options?: RuntimeExecuteOptions,
    ): Promise<SqlStatementStats> {
      if (invalidated) {
        throw transactionClosedError();
      }
      return runPreparedExecute(transaction, ps, params, options);
    },
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
      // After a failed COMMIT the server-side transaction may be: (a) already committed (error on response path), (b) already rolled back (deferred constraint / serialization failure), or (c) still open (COMMIT never reached the server). Attempt a best-effort rollback to cover (c) and confirm the protocol is healthy.
      //
      // If rollback succeeds, the server is definitely no longer in a transaction (no-op in (a)/(b), real cleanup in (c)) and we've just proved the connection round-trips correctly — it's safe to return to the pool. If rollback fails, the connection state is ambiguous (broken socket, protocol desync, etc.) and we must destroy it.
      try {
        await transaction.rollback();
      } catch {
        await destroyConnection(commitError);
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

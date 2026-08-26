import type { Contract } from '@prisma-next/contract/types';
import {
  AsyncIterableResult,
  checkAborted,
  checkMiddlewareCompatibility,
  RuntimeCore,
  type RuntimeExecuteOptions,
  type RuntimeLog,
  type RuntimeMiddlewareContext,
  runBeforeExecuteChain,
  runtimeError,
  runWithMiddleware,
} from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
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
  SqlTransaction,
} from '@prisma-next/sql-relational-core/ast';
import { collectOrderedParamRefs } from '@prisma-next/sql-relational-core/ast';
import type { CodecTypesBase } from '@prisma-next/sql-relational-core/expression';
import {
  createSqlParamRefMutator,
  type SqlParamRefMutator,
  type SqlParamRefMutatorInternal,
} from '@prisma-next/sql-relational-core/middleware';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import type { RuntimeScope } from '@prisma-next/sql-relational-core/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { buildDecodeContext, type DecodeContext, decodeRow } from './codecs/decoding';
import { deriveParamMetadata, encodeParams, encodeParamsWithMetadata } from './codecs/encoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';
import { computeSqlContentHash } from './content-hash';
import { computeSqlFingerprint } from './fingerprint';
import { lowerSqlPlan } from './lower-sql-plan';
import { runBeforeCompileChain } from './middleware/before-compile-chain';
import type { SqlMiddleware, SqlMiddlewareContext } from './middleware/sql-middleware';
import { buildBindSiteParams } from './prepared/bind-site-params';
import { resolvePreparedSlotValues } from './prepared/encode-prepared';
import {
  PreparedStatementImpl,
  type PreparedStatementInternals,
} from './prepared/prepared-statement';
import type {
  Declaration,
  ParamsFromDeclaration,
  PrepareCallback,
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

export interface RuntimeOptions<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly adapter: Adapter<AnyQueryAst, Contract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver<unknown>;
  readonly verifyMarker?: VerifyMarkerOption;
  readonly middleware?: readonly SqlMiddleware[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

/**
 * SQL-family runtime interface. Named `Runtime` (not `SqlRuntime`) by deliberate exception
 * to avoid a repo-wide rename; see ADR 230 (runtime target layer) for the recorded decision.
 */
export interface Runtime extends RuntimeQueryable {
  connection(): Promise<RuntimeConnection>;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;

  /**
   * Build a reusable {@link PreparedStatement}. Throws
   * `RUNTIME.PREPARE_UNUSED_PARAM` if any declared name is unreferenced
   * by the callback's plan.
   */
  prepare<D extends Declaration<CT>, Row, CT extends CodecTypesBase = CodecTypesBase>(
    declaration: D,
    callback: PrepareCallback<D, Row>,
  ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>>;
}

export interface RuntimeConnection extends RuntimeQueryable {
  transaction(): Promise<RuntimeTransaction>;
  /**
   * Register a hook to run immediately before the connection is released back to the pool.
   * Hooks are invoked in registration order and awaited sequentially. If any hook throws,
   * the connection is destroyed rather than returned to the pool, and the error propagates.
   * Not invoked when `destroy()` is called directly.
   */
  registerReleaseHook(hook: () => Promise<void>): void;
  /**
   * Returns the connection to the pool for reuse. Runs all registered release hooks first;
   * if any hook throws the connection is destroyed and the error propagates. Only call this
   * when the connection is known to be in a clean state. If a transaction commit/rollback
   * failed or the connection is otherwise suspect, call `destroy(reason)` instead.
   */
  release(): Promise<void>;
  /**
   * Evicts the connection so it is never reused. Call this when the connection may be in an
   * indeterminate state (e.g. a failed rollback leaving an open transaction, or a broken socket).
   *
   * If teardown fails the error is propagated and the connection remains retryable, so the caller
   * can decide whether to swallow the failure or retry cleanup. Calling destroy() or release() more
   * than once after a successful teardown is caller error.
   *
   * `reason` is advisory context only. It may be surfaced to driver-level observability hooks
   * (e.g. pg-pool's `'release'` event) but does not influence eviction behavior and is not rethrown.
   */
  destroy(reason?: unknown): Promise<void>;
}

/**
 * Restricted view of a {@link RuntimeConnection} passed to a {@link withConnection} callback.
 * Exposes query execution and release-hook registration, but not the raw `release()` / `destroy()`
 * lifecycle methods — those are managed by `withConnection` itself.
 */
export interface ConnectionContext extends RuntimeQueryable {
  registerReleaseHook(hook: () => Promise<void>): void;
}

export interface RuntimeTransaction extends RuntimeQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /**
   * Register a hook to run immediately before the transaction is committed.
   * Hooks are invoked in registration order and awaited sequentially. If any
   * hook throws, the commit is aborted and the error propagates to the caller.
   * Not invoked on rollback.
   */
  registerPreCommitHook(hook: () => Promise<void>): void;
  runPreCommitHooks(): Promise<void>;
}

export interface RuntimeQueryable extends RuntimeScope {
  /**
   * Run a prepared statement against this scope. Required for the explicit
   * `PreparedStatement.execute(target, params)` API — every scope (top-level
   * runtime, connection, transaction) routes prepared executions through the
   * `SqlQueryable` it is backed by.
   */
  executePrepared<Params, Row>(
    ps: PreparedStatement<Params, Row>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
}

export interface TransactionContext extends RuntimeQueryable {
  readonly invalidated: boolean;
  /**
   * Register a hook to run immediately before the transaction is committed.
   * Hooks are invoked in registration order and awaited sequentially. If any
   * hook throws, the commit is aborted and the error propagates to the caller.
   * Not invoked on rollback.
   */
  registerPreCommitHook(hook: () => Promise<void>): void;
}

export type { RuntimeTelemetryEvent, TelemetryOutcome, VerifyMarkerOption };

function isExecutionPlan(plan: SqlExecutionPlan | SqlQueryPlan): plan is SqlExecutionPlan {
  return 'sql' in plan;
}

// v8 ignore next 2
const noopLogSink = (): void => {};
const noopLog: Log = { info: noopLogSink, warn: noopLogSink, error: noopLogSink };

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
  // Single-flight gate. Memoises the first verifyMarker() call so concurrent first-queries share one read + one log line. `null` until the first gate hit; pre-resolved when `verifyMarkerOption === false` so the gate becomes a no-op await.
  private verifyMarkerPromise: Promise<void> | null;
  readonly #preparedStatementHandles = new WeakMap<object, unknown>();
  private codecRegistryValidated: boolean;
  private _telemetry: RuntimeTelemetryEvent | null;

  constructor(options: RuntimeOptions<TContract>) {
    const { context, adapter, driver, verifyMarker, middleware, mode, log } = options;

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
      // ctx is only invoked by runWithMiddleware with execs this runtime lowered; the framework parameter type is the cross-family base.
      contentHash: (exec) => computeSqlContentHash(exec as SqlExecutionPlan),
      scope: 'runtime',
      // Placeholder satisfying the required field on the cross-family base. The
      // stored ctx is a runtime-level template; the per-execute ctxs constructed
      // in `executeAgainstQueryable` / `executePreparedAgainstQueryable` spread
      // this template and override `planExecutionId` with a fresh UUID. ADR 220.
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
    this.codecRegistryValidated = false;
    this.verifyMarkerPromise = this.verifyMarkerOption === false ? Promise.resolve() : null;
    this._telemetry = null;
  }

  /**
   * Lower a `SqlQueryPlan` (AST + meta) into a `SqlExecutionPlan`
   * with encoded parameters ready for the driver.
   *
   * Implementation note: SQL splits lower-then-encode across
   * {@link lowerToDraft} + {@link encodeDraftParams} so the runtime
   * can fire the `beforeExecute` middleware chain between them
   * (cipherstash bulk-encrypt, for example, mutates pre-encode
   * `ParamRef.value` slots). This protected hook composes the two
   * back into the cross-family `lower()` shape `RuntimeCore.execute`
   * expects, and is called from the no-middleware fast paths /
   * fixtures that hit `RuntimeCore`'s default template directly.
   * `execute()` overrides the template and uses the split form so
   * `beforeExecute` lands between the two halves.
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
   * AST → pre-encode draft. The returned plan has `sql` rendered and
   * `params` populated with the user-domain values the lowering site
   * collected from `ParamRef` nodes. No codec encode has happened
   * yet; consumers can mutate `params` via the `SqlParamRefMutator`
   * before {@link encodeDraftParams} runs.
   */
  private lowerToDraft(plan: SqlQueryPlan): SqlExecutionPlan {
    return lowerSqlPlan(this.adapter, this.contract, plan);
  }

  /**
   * Encode a draft plan's params through the per-column codecs and
   * freeze the result into the final `SqlExecutionPlan` the driver
   * sees. Errors surface as `RUNTIME.ENCODE_FAILED` envelopes from
   * {@link encodeParams}.
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

  /**
   * Default driver invocation required by the abstract `RuntimeCore` contract. Every production path overrides `execute()` and routes through `executeAgainstQueryable`, so this hook is defensive only — subclasses that delegate back to `super.execute()` would land here.
   */
  // v8 ignore next 6
  protected override runDriver(exec: SqlExecutionPlan): AsyncIterable<Record<string, unknown>> {
    return this.driver.execute<Record<string, unknown>>({
      sql: exec.sql,
      params: exec.params,
    });
  }

  /**
   * SQL pre-compile hook. Runs the registered middleware `beforeCompile` chain over the plan's draft (AST + meta). Returns the original plan unchanged when no middleware rewrote the AST; otherwise returns a new plan carrying the rewritten AST and meta. The AST is the authoritative source of execution metadata, so a rewrite needs no sidecar reconciliation here — the lowering adapter and the encoder both walk the rewritten
   * AST directly.
   */
  protected override async runBeforeCompile(plan: SqlQueryPlan): Promise<SqlQueryPlan> {
    const rewrittenDraft = await runBeforeCompileChain(
      this.middleware,
      { ast: plan.ast, meta: plan.meta },
      this.sqlCtx,
    );
    return rewrittenDraft.ast === plan.ast
      ? plan
      : { ...plan, ast: rewrittenDraft.ast, meta: rewrittenDraft.meta };
  }

  override execute<Row>(
    plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.executeAgainstQueryable<Row>(plan, this.driver, options);
  }

  executePrepared<Params, Row>(
    ps: PreparedStatement<Params, Row>,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    return this.executePreparedAgainstQueryable<Params, Row>(
      ps as PreparedStatementImpl<Params, Row>,
      params as Record<string, unknown>,
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

  private async *streamRows<Row>(
    exec: SqlExecutionPlan,
    decodeContext: DecodeContext,
    driverCall: () => AsyncIterable<Record<string, unknown>>,
    codecCtx: SqlCodecCallContext,
    execMiddlewareCtx: RuntimeMiddlewareContext,
  ): AsyncGenerator<Row, void, unknown> {
    this.familyAdapter.validatePlan(exec, this.contract);
    this._telemetry = null;

    if (this.verifyMarkerPromise === null) {
      this.verifyMarkerPromise = this.verifyMarker();
    }
    await this.verifyMarkerPromise;

    const startedAt = Date.now();
    let outcome: TelemetryOutcome | null = null;

    try {
      const stream = runWithMiddleware<SqlExecutionPlan, Record<string, unknown>>(
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
      try {
        while (true) {
          checkAborted(codecCtx, 'stream');
          const next = await iterator.next();
          if (next.done) {
            break;
          }
          const decodedRow = await decodeRow(next.value, decodeContext, codecCtx);
          yield decodedRow as Row;
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

  /**
   * Execute a plan against a caller-supplied queryable, running the full
   * middleware/codec/telemetry pipeline. Use `acquireRawConnection` to obtain a
   * queryable that subclasses can bind typed plans to.
   */
  protected executeAgainstQueryable<Row>(
    plan: SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>,
    queryable: SqlQueryable,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated();

    const self = this;
    const signal = options?.signal;
    const scope = options?.scope ?? 'runtime';
    // One ctx per execute() call — the same reference is shared by encodeParams (lower), decodeRow (per-row), and the stream loop's between-row checks. Per-cell ctx allocations inside decodeField add `column` for resolvable cells without re-wrapping the signal. The ctx object is always allocated; the `signal` field is only included when a signal was supplied (exactOptionalPropertyTypes).
    const codecCtx: SqlCodecCallContext = signal === undefined ? {} : { signal };

    // Per-execute view of the middleware ctx that carries the per-query
    // signal. `self.ctx` is allocated once at construction (no signal); we
    // shallow-clone it here so middleware sees the same `AbortSignal`
    // reference threaded into `codecCtx.signal` (ADR 207 identity).
    //
    // The middleware context for this execution is also scope-narrowed: the
    // top-level runtime path uses the constructor-time `'runtime'` ctx as-is;
    // `connection.execute` and `transaction.execute` produce a derived ctx
    // with the appropriate scope. Middleware that observe `ctx.scope`
    // (e.g. the cache middleware, which only intercepts at `'runtime'`)
    // see the right value without any out-of-band signaling.
    //
    // `planExecutionId` is minted here too: every execute() call — top-level,
    // connection-scoped, or transaction-scoped — flows through this helper and
    // gets its own fresh UUID. Hooks for one call see the same value; two
    // calls (even with the same plan) see distinct values. ADR 220.
    const execMiddlewareCtx: RuntimeMiddlewareContext = {
      ...self.ctx,
      ...ifDefined('signal', signal),
      ...(scope !== 'runtime' ? { scope } : {}),
      planExecutionId: crypto.randomUUID(),
    };

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      checkAborted(codecCtx, 'stream');

      let exec: SqlExecutionPlan;
      if (isExecutionPlan(plan)) {
        // Pre-lowered fixture path. The plan's params are typically
        // already encoded; we still fire `beforeExecute` so middleware
        // that mutates ParamRef values (e.g. cipherstash bulk-encrypt)
        // gets a chance to run, then re-encode so any mutations land.
        const preEncodeMutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(plan);
        await runBeforeExecuteChain<SqlExecutionPlan, SqlParamRefMutator>(
          plan,
          self.middleware,
          execMiddlewareCtx,
          preEncodeMutator,
        );
        exec = Object.freeze({
          ...plan,
          params: await encodeParams(
            { ...plan, params: preEncodeMutator.currentParams() },
            codecCtx,
            self.contractCodecs,
          ),
        });
      } else {
        // Standard AST → exec path. Split lower from encode so the
        // `beforeExecute` chain fires between them with a mutator built
        // over the pre-encode draft params; encode then renders the
        // (possibly mutated) values through the column codecs.
        const compiled = await self.runBeforeCompile(plan);
        const draft = self.lowerToDraft(compiled);
        const preEncodeMutator: SqlParamRefMutatorInternal = createSqlParamRefMutator(draft);
        await runBeforeExecuteChain<SqlExecutionPlan, SqlParamRefMutator>(
          draft,
          self.middleware,
          execMiddlewareCtx,
          preEncodeMutator,
        );
        const draftWithMutations: SqlExecutionPlan = Object.freeze({
          ...draft,
          params: preEncodeMutator.currentParams(),
        });
        exec = await self.encodeDraftParams(draftWithMutations, codecCtx);
      }

      const decodeContext = buildDecodeContext(exec.ast, self.contractCodecs);

      yield* self.streamRows<Row>(
        exec,
        decodeContext,
        () => queryable.execute<Record<string, unknown>>({ sql: exec.sql, params: exec.params }),
        codecCtx,
        execMiddlewareCtx,
      );
    };

    return new AsyncIterableResult(generator());
  }

  async prepare<D extends Declaration<CT>, Row, CT extends CodecTypesBase = CodecTypesBase>(
    declaration: D,
    callback: PrepareCallback<D, Row>,
  ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>> {
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

    return new PreparedStatementImpl<ParamsFromDeclaration<D, CT>, Row>(internals);
  }

  /**
   * Execute a prepared statement against a caller-supplied queryable, running
   * the full middleware/codec/telemetry pipeline.
   */
  protected executePreparedAgainstQueryable<P, Row>(
    ps: PreparedStatementImpl<P, Row>,
    userParams: Record<string, unknown>,
    queryable: SqlQueryable,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated();

    const self = this;
    const signal = options?.signal;
    const scope = options?.scope ?? 'runtime';
    const codecCtx: SqlCodecCallContext = signal === undefined ? {} : { signal };
    // `executePrepared` is a parallel entry point to `executeAgainstQueryable`
    // and mints its own fresh `planExecutionId` per call. ADR 220.
    const execMiddlewareCtx: RuntimeMiddlewareContext = {
      ...self.ctx,
      ...ifDefined('signal', signal),
      ...(scope !== 'runtime' ? { scope } : {}),
      planExecutionId: crypto.randomUUID(),
    };

    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
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
      await runBeforeExecuteChain<SqlExecutionPlan, SqlParamRefMutator>(
        preEncodeExec,
        self.middleware,
        execMiddlewareCtx,
        mutator,
      );

      const encodedParams = await encodeParamsWithMetadata(
        mutator.currentParams(),
        ps.paramMetadata,
        codecCtx,
        self.contractCodecs,
      );
      const exec: SqlExecutionPlan = {
        sql: ps.sql,
        params: encodedParams,
        ast: ps.ast,
        meta: ps.meta,
      };

      const handles = self.#preparedStatementHandles;
      const request: PreparedExecuteRequest = {
        sql: exec.sql,
        params: exec.params,
        handle: {
          get: () => handles.get(ps),
          set: (value) => {
            handles.set(ps, value);
          },
        },
      };

      yield* self.streamRows<Row>(
        exec,
        ps.decodeContext,
        () => queryable.executePrepared<Record<string, unknown>>(request),
        codecCtx,
        execMiddlewareCtx,
      );
    };

    return new AsyncIterableResult(generator());
  }

  async connection(): Promise<RuntimeConnection> {
    const driverConn = await this.driver.acquireConnection();
    const self = this;
    const releaseHooks: Array<() => Promise<void>> = [];

    const wrappedConnection: RuntimeConnection = {
      async transaction(): Promise<RuntimeTransaction> {
        const driverTx = await driverConn.beginTransaction();
        return self.wrapTransaction(driverTx);
      },
      registerReleaseHook(hook: () => Promise<void>): void {
        releaseHooks.push(hook);
      },
      async release(): Promise<void> {
        try {
          let hook = releaseHooks.shift();
          while (hook !== undefined) {
            await hook();
            hook = releaseHooks.shift();
          }
          await driverConn.release();
        } catch (err) {
          await driverConn.destroy(err);
          throw err;
        }
      },
      async destroy(reason?: unknown): Promise<void> {
        await driverConn.destroy(reason);
      },
      execute<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.executeAgainstQueryable<Row>(plan, driverConn, {
          ...options,
          scope: 'connection',
        });
      },
      executePrepared<Params, Row>(
        ps: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.executePreparedAgainstQueryable<Params, Row>(
          ps as PreparedStatementImpl<Params, Row>,
          params as Record<string, unknown>,
          driverConn,
          { ...options, scope: 'connection' },
        );
      },
    };

    return wrappedConnection;
  }

  protected wrapTransaction(driverTx: SqlTransaction): RuntimeTransaction {
    const self = this;
    const preCommitHooks: Array<() => Promise<void>> = [];
    return {
      registerPreCommitHook(hook: () => Promise<void>): void {
        preCommitHooks.push(hook);
      },
      async runPreCommitHooks(): Promise<void> {
        let hook = preCommitHooks.shift();
        while (hook !== undefined) {
          await hook();
          hook = preCommitHooks.shift();
        }
      },
      async commit(): Promise<void> {
        let hook = preCommitHooks.shift();
        while (hook !== undefined) {
          await hook();
          hook = preCommitHooks.shift();
        }
        await driverTx.commit();
      },
      async rollback(): Promise<void> {
        await driverTx.rollback();
      },
      execute<Row>(
        plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.executeAgainstQueryable<Row>(plan, driverTx, {
          ...options,
          scope: 'transaction',
        });
      },
      executePrepared<Params, Row>(
        ps: PreparedStatement<Params, Row>,
        params: Params,
        options?: RuntimeExecuteOptions,
      ): AsyncIterableResult<Row> {
        return self.executePreparedAgainstQueryable<Params, Row>(
          ps as PreparedStatementImpl<Params, Row>,
          params as Record<string, unknown>,
          driverTx,
          { ...options, scope: 'transaction' },
        );
      },
    };
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this._telemetry;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private ensureCodecRegistryValidated(): void {
    if (!this.codecRegistryValidated) {
      validateCodecRegistryCompleteness(this.codecDescriptors, this.contract);
      this.codecRegistryValidated = true;
    }
  }

  private async verifyMarker(): Promise<void> {
    const readResult = await this.familyAdapter.markerReader.readMarker(this.driver);

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
    const contract = this.contract as { target: string };
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
    'Cannot read from a query result after the transaction has ended. Await the result or call .toArray() inside the transaction callback.',
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

  const txContext: TransactionContext = {
    get invalidated() {
      return invalidated;
    },
    execute<Row>(
      plan: (SqlExecutionPlan<unknown> | SqlQueryPlan<unknown>) & { readonly _row?: Row },
      options?: RuntimeExecuteOptions,
    ): AsyncIterableResult<Row> {
      if (invalidated) {
        throw transactionClosedError();
      }
      return new AsyncIterableResult(guardedStream(transaction.execute(plan, options)));
    },
    executePrepared<Params, Row>(
      ps: PreparedStatement<Params, Row>,
      params: Params,
      options?: RuntimeExecuteOptions,
    ): AsyncIterableResult<Row> {
      if (invalidated) {
        throw transactionClosedError();
      }
      return new AsyncIterableResult(
        guardedStream(transaction.executePrepared(ps, params, options)),
      );
    },
    registerPreCommitHook(hook: () => Promise<void>): void {
      if (invalidated) {
        throw transactionClosedError();
      }
      transaction.registerPreCommitHook(hook);
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
      await transaction.runPreCommitHooks();
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

export async function withConnection<R>(
  runtime: ConnectionProvider,
  fn: (conn: ConnectionContext) => PromiseLike<R>,
): Promise<R> {
  const connection = await runtime.connection();
  let released = false;
  try {
    const result = await fn(connection);
    released = true;
    await connection.release();
    return result;
  } catch (err) {
    if (!released) {
      await connection.destroy(err).catch(() => undefined);
    }
    throw err;
  }
}

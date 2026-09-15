import type { CodecCallContext } from '@internal/framework-components/codec';
import {
  AsyncIterableResult,
  checkAborted,
  checkMiddlewareCompatibility,
  RuntimeCore,
  type RuntimeExecuteOptions,
  type RuntimeMiddlewareContext,
  type RuntimeStatementStats,
  runBeforeExecuteChain,
  runBeforeQueryChain,
  runExecuteWithMiddleware,
  runQueryWithMiddleware,
  runtimeError,
} from '@internal/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { decodeMongoRow } from './codecs/decoding';
import { computeMongoContentHash } from './content-hash';
import type { MongoExecutionPlan } from './mongo-execution-plan';
import type { MongoCodecLookup, MongoExecutionContext } from './mongo-execution-stack';
import type { MongoMiddleware, MongoMiddlewareContext } from './mongo-middleware';
import {
  createMongoParamRefMutator,
  type MongoParamRefMutator,
  type MongoParamRefMutatorInternal,
} from './param-ref-mutator';

function noop() {}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statisticsCountField(commandKind: string): 'modifiedCount' | 'deletedCount' | undefined {
  switch (commandKind) {
    case 'updateOne':
    case 'updateMany':
      return 'modifiedCount';
    case 'deleteOne':
    case 'deleteMany':
      return 'deletedCount';
    default:
      return undefined;
  }
}

function invalidStatisticsResult(commandKind: string, countField: string): Error {
  return runtimeError(
    'RUNTIME.MONGO_STATISTICS_RESULT_INVALID',
    `Mongo command '${commandKind}' did not return exactly one numeric '${countField}' result`,
    { commandKind, countField },
  );
}

/**
 * Mongo runtime options.
 *
 * The runtime takes a {@link MongoExecutionContext} (built via
 * `createMongoExecutionContext`) and a driver. Codec resolution flows from
 * the context — there is no `codecs` field on this options bag. The adapter
 * is reached via `context.stack.adapter` (instantiated lazily through the
 * stack's `create(stack)` factory). See ADR — Mongo result-shape as a
 * structural plan field, § Codec registry: stack aggregation, not user
 * threading.
 */
export interface MongoRuntimeOptions {
  readonly context: MongoExecutionContext;
  readonly driver: MongoDriver;
  readonly middleware?: readonly MongoMiddleware[];
  readonly mode?: 'strict' | 'permissive';
}

export interface MongoRuntime {
  /**
   * Query a `MongoQueryPlan` and return an async iterable of rows.
   *
   * The optional `options.signal` is threaded through
   * `lower → adapter.lower → resolveValue → codec.encode` so codec authors
   * who forward the signal to their underlying SDK get true cancellation
   * of in-flight network calls. The runtime additionally observes the
   * signal at two boundaries:
   *
   * - **Already-aborted at entry** — first `next()` throws
   *   `RUNTIME.ABORTED { phase: 'stream' }` before any work is done.
   *   (Inherited from `RuntimeCore.query`.)
   * - **Mid-encode abort** — surfaces as
   *   `RUNTIME.ABORTED { phase: 'encode' }` from inside `resolveValue`'s
   *   per-level `Promise.all` race.
   *
   * Mongo's read path decodes rows via `resultShape` (per ADR 209). The
   * same `CodecCallContext` is forwarded into each `codec.decode(wire, ctx)`
   * call synchronously; the runtime does not emit a `phase: 'decode'` envelope.
   */
  query<Row>(plan: MongoQueryPlan<Row>, options?: RuntimeExecuteOptions): AsyncIterableResult<Row>;
  execute(plan: MongoQueryPlan, options?: RuntimeExecuteOptions): Promise<RuntimeStatementStats>;
  close(): Promise<void>;
}

class MongoRuntimeImpl
  extends RuntimeCore<MongoQueryPlan, MongoExecutionPlan, MongoMiddleware>
  implements MongoRuntime
{
  readonly #adapter: MongoAdapter;
  readonly #driver: MongoDriver;
  readonly #codecs: MongoCodecLookup;

  constructor(options: MongoRuntimeOptions) {
    const middleware = options.middleware ? [...options.middleware] : [];
    const targetId = options.context.stack.target.targetId;
    for (const mw of middleware) {
      checkMiddlewareCompatibility(mw, 'mongo', targetId);
    }

    const ctx: MongoMiddlewareContext = {
      contract: options.context.contract,
      mode: options.mode ?? 'strict',
      now: () => Date.now(),
      log: { info: noop, warn: noop, error: noop },
      // ctx is only invoked by operation-specific middleware runner with execs this runtime lowered;
      // the framework parameter type is the cross-family base.
      contentHash: (exec) =>
        computeMongoContentHash(
          blindCast<
            MongoExecutionPlan,
            'operation-specific middleware runner passes execs this runtime lowered'
          >(exec),
        ),
      // When MongoRuntimeImpl grows connection()/transaction() surfaces,
      // derive a scope-narrowed ctx per call (mirror
      // SqlRuntime#executeStatisticsAgainstQueryable in `sql-runtime.ts`).
      scope: 'runtime',
      // Placeholder satisfying the required field on the cross-family base. The
      // stored ctx is a runtime-level template; each query overrides
      // `planExecutionId` with a fresh UUID. ADR 220.
      planExecutionId: '',
    };

    super({ middleware, ctx });

    const adapterDescriptor = options.context.stack.adapter;
    const adapterInstance = adapterDescriptor.create(options.context.stack);
    this.#adapter = adapterInstance;
    this.#driver = options.driver;
    this.#codecs = options.context.codecs;
  }

  /* v8 ignore start -- one-phase lower satisfies RuntimeCore; operations use the split preparation pipeline */
  protected override async lower(
    plan: MongoQueryPlan,
    ctx: CodecCallContext,
  ): Promise<MongoExecutionPlan> {
    return {
      command: await this.#adapter.lower(plan, ctx),
      meta: plan.meta,
      ...ifDefined('resultShape', plan.resultShape),
    };
  }
  /* v8 ignore stop */

  protected override runDriver(exec: MongoExecutionPlan): AsyncIterable<Record<string, unknown>> {
    return this.#driver.execute<Record<string, unknown>>(exec.command);
  }

  protected override runExecute(exec: MongoExecutionPlan): Promise<RuntimeStatementStats> {
    return this.#readDriverStatistics(exec);
  }

  private createQueryContexts(options: RuntimeExecuteOptions | undefined): {
    readonly codecCtx: CodecCallContext;
    readonly middlewareCtx: MongoMiddlewareContext;
  } {
    const signal = options?.signal;
    const codecCtx: CodecCallContext = signal === undefined ? {} : { signal };
    const middlewareCtx: MongoMiddlewareContext = {
      ...this.ctx,
      ...ifDefined('signal', signal),
      planExecutionId: crypto.randomUUID(),
    };
    return { codecCtx, middlewareCtx };
  }

  private prepareQueryExecution(
    plan: MongoQueryPlan,
    codecCtx: CodecCallContext,
    middlewareCtx: MongoMiddlewareContext,
  ): Promise<MongoExecutionPlan> {
    return this.prepareOperation(plan, codecCtx, middlewareCtx, runBeforeQueryChain);
  }

  private prepareExecuteExecution(
    plan: MongoQueryPlan,
    codecCtx: CodecCallContext,
    middlewareCtx: MongoMiddlewareContext,
  ): Promise<MongoExecutionPlan> {
    return this.prepareOperation(plan, codecCtx, middlewareCtx, runBeforeExecuteChain);
  }

  private async prepareOperation(
    plan: MongoQueryPlan,
    codecCtx: CodecCallContext,
    middlewareCtx: MongoMiddlewareContext,
    runBefore: (
      plan: MongoExecutionPlan,
      middleware: ReadonlyArray<MongoMiddleware>,
      ctx: RuntimeMiddlewareContext,
      mutator: MongoParamRefMutator,
    ) => Promise<void>,
  ): Promise<MongoExecutionPlan> {
    checkAborted(codecCtx, 'stream');
    const compiled = await this.runBeforeCompile(plan);
    const draft = this.#adapter.structuralLower(compiled);
    const mutator: MongoParamRefMutatorInternal = createMongoParamRefMutator(draft);
    const draftExec: MongoExecutionPlan = {
      meta: compiled.meta,
      ...ifDefined('resultShape', compiled.resultShape),
      command: blindCast<
        MongoExecutionPlan['command'],
        'MongoLoweredDraft held in command slot before parameter resolution'
      >(draft),
    };

    await runBefore(draftExec, this.middleware, middlewareCtx, mutator);

    return {
      meta: compiled.meta,
      ...ifDefined('resultShape', compiled.resultShape),
      command: await this.#adapter.resolveParams(mutator.currentDraft(), codecCtx),
    };
  }

  override query<Row>(
    plan: MongoQueryPlan & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    const self = this;
    const { codecCtx, middlewareCtx } = this.createQueryContexts(options);
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      const exec = await self.prepareQueryExecution(plan, codecCtx, middlewareCtx);
      const stream = runQueryWithMiddleware<MongoExecutionPlan, Record<string, unknown>>(
        exec,
        self.middleware,
        middlewareCtx,
        () => self.runDriver(exec),
      );
      for await (const rawRow of stream) {
        checkAborted(codecCtx, 'stream');
        if (exec.resultShape === undefined) {
          yield blindCast<Row, 'driver row matches plan _row phantom when resultShape is absent'>(
            rawRow,
          );
        } else {
          const decoded = decodeMongoRow(
            rawRow,
            exec.resultShape,
            self.#codecs,
            exec.command.collection,
            codecCtx,
          );
          yield blindCast<Row, 'decodeMongoRow output matches plan _row phantom'>(decoded);
        }
      }
    };
    return new AsyncIterableResult(generator());
  }

  override async execute(
    plan: MongoQueryPlan,
    options?: RuntimeExecuteOptions,
  ): Promise<RuntimeStatementStats> {
    const { codecCtx, middlewareCtx } = this.createQueryContexts(options);
    const exec = await this.prepareExecuteExecution(plan, codecCtx, middlewareCtx);
    checkAborted(codecCtx, 'stream');
    return runExecuteWithMiddleware(exec, this.middleware, middlewareCtx, () =>
      this.runExecute(exec),
    );
  }

  async #readDriverStatistics(exec: MongoExecutionPlan): Promise<RuntimeStatementStats> {
    const countField = statisticsCountField(exec.command.kind);
    if (countField === undefined) {
      throw runtimeError(
        'RUNTIME.MONGO_STATISTICS_UNSUPPORTED',
        `Mongo command '${exec.command.kind}' does not expose statement statistics`,
        { commandKind: exec.command.kind },
      );
    }

    let affectedRows: number | undefined;
    for await (const result of this.#driver.execute<unknown>(exec.command)) {
      if (affectedRows !== undefined || !isUnknownRecord(result)) {
        throw invalidStatisticsResult(exec.command.kind, countField);
      }
      const count = result[countField];
      if (typeof count !== 'number') {
        throw invalidStatisticsResult(exec.command.kind, countField);
      }
      affectedRows = count;
    }
    if (affectedRows === undefined) {
      throw invalidStatisticsResult(exec.command.kind, countField);
    }
    return { affectedRows };
  }

  override async close(): Promise<void> {
    await this.#driver.close();
  }
}

export function createMongoRuntime(options: MongoRuntimeOptions): MongoRuntime {
  return new MongoRuntimeImpl(options);
}

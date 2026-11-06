import type { CodecCallContext } from '@internal/framework-components/codec';
import {
  type ActivityContextFields,
  AsyncIterableResult,
  checkAborted,
  checkMiddlewareCompatibility,
  executeStatement,
  RuntimeCore,
  type RuntimeExecuteOptions,
  type RuntimeMode,
  type RuntimeStatementStats,
  runtimeError,
  type StatementActivityRun,
  streamStatement,
} from '@internal/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
import type {
  MongoCodecLookup,
  MongoExecutionContext,
  MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type StructuredError, structuredError } from '@internal/utils/structured-error';
import { decodeMongoRow } from './codecs/decoding';
import { computeMongoContentHash } from './content-hash';
import type { MongoExecutionPlan } from './mongo-execution-plan';
import type { MongoMiddleware, MongoMiddlewareContext } from './mongo-middleware';
import {
  createMongoParamRefMutator,
  type MongoParamRefMutator,
  type MongoParamRefMutatorInternal,
} from './param-ref-mutator';

type MongoStatementActivityRun = StatementActivityRun<
  MongoExecutionPlan,
  MongoParamRefMutator,
  MongoMiddlewareContext
>;

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

function runtimeClosedError(): StructuredError {
  return structuredError('DRIVER.NOT_CONNECTED', 'Runtime is closed', {
    why: 'close() was called on this runtime, or on the client or connection that owns it. An await using scope calls close() when it ends.',
    fix: 'Await every query before close(). The usual cause is a query returned without await from an await using scope.',
  });
}

/**
 * Mongo runtime options.
 *
 * The runtime takes a {@link MongoExecutionContext} (built via `createMongoExecutionContext`), an adapter, and a driver, as the SQL runtime does. Codecs and the target come from the context. See ADR — Mongo result-shape as a structural plan field, § Codec registry: stack aggregation, not user threading.
 */
export interface MongoRuntimeOptions {
  readonly context: MongoExecutionContext;
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver<unknown>;
  readonly middleware?: readonly MongoMiddleware[];
  readonly mode?: RuntimeMode;
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
   * same `CodecCallContext` is forwarded into each `codec.fromWire(wire, ctx)`
   * call, so async decoders that respect the signal get cancellation; the
   * runtime itself does not currently emit a `phase: 'decode'` envelope.
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
  readonly #driver: MongoDriver<unknown>;
  readonly #codecs: MongoCodecLookup;
  readonly #contextFields: ActivityContextFields<MongoMiddlewareContext>;
  #closed = false;

  constructor(options: MongoRuntimeOptions) {
    const middleware = options.middleware ?? [];
    for (const mw of middleware) {
      checkMiddlewareCompatibility(mw, 'mongo', options.context.contract.target);
    }

    const ctx: ActivityContextFields<MongoMiddlewareContext> = {
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
    };

    super({ middleware, ctx });
    this.#contextFields = ctx;

    this.#adapter = options.adapter;
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
    if (this.#closed) {
      throw runtimeClosedError();
    }
    return this.#driver.execute<Record<string, unknown>>(exec.command);
  }

  protected override runExecute(exec: MongoExecutionPlan): Promise<RuntimeStatementStats> {
    return this.#readDriverStatistics(exec);
  }

  private createQueryContexts(options: RuntimeExecuteOptions | undefined): {
    readonly codecCtx: CodecCallContext;
    readonly contextFields: ActivityContextFields<MongoMiddlewareContext>;
  } {
    const signal = options?.signal;
    const codecCtx: CodecCallContext = signal === undefined ? {} : { signal };
    const contextFields: ActivityContextFields<MongoMiddlewareContext> = {
      ...this.#contextFields,
      ...ifDefined('signal', signal),
    };
    return { codecCtx, contextFields };
  }

  private async prepareOperation(
    plan: MongoQueryPlan,
    codecCtx: CodecCallContext,
    run: MongoStatementActivityRun,
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

    await run.beforeEncode(draftExec, mutator);

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
    const { codecCtx, contextFields } = this.createQueryContexts(options);
    const generator = async function* (): AsyncGenerator<Row, void, unknown> {
      yield* streamStatement(
        { middleware: self.middleware, plan, context: contextFields, parent: undefined },
        async function* (run: MongoStatementActivityRun): AsyncGenerator<Row, void, unknown> {
          const exec = await self.prepareOperation(plan, codecCtx, run);
          yield* self.#decodedRows<Row>(run, exec, codecCtx);
        },
      );
    };
    return new AsyncIterableResult(generator());
  }

  async *#decodedRows<Row>(
    run: MongoStatementActivityRun,
    exec: MongoExecutionPlan,
    codecCtx: CodecCallContext,
  ): AsyncGenerator<Row, void, unknown> {
    const stream = run.runQuery(exec, () => this.runDriver(exec));
    for await (const rawRow of stream) {
      checkAborted(codecCtx, 'stream');
      if (exec.resultShape === undefined) {
        yield blindCast<Row, 'driver row matches plan _row phantom when resultShape is absent'>(
          rawRow,
        );
      } else {
        const decoded = await decodeMongoRow(
          rawRow,
          exec.resultShape,
          this.#codecs,
          exec.command.collection,
          codecCtx,
        );
        yield blindCast<Row, 'decodeMongoRow output matches plan _row phantom'>(decoded);
      }
    }
  }

  override execute(
    plan: MongoQueryPlan,
    options?: RuntimeExecuteOptions,
  ): Promise<RuntimeStatementStats> {
    const { codecCtx, contextFields } = this.createQueryContexts(options);
    return executeStatement(
      { middleware: this.middleware, plan, context: contextFields, parent: undefined },
      async (run: MongoStatementActivityRun) => {
        const exec = await this.prepareOperation(plan, codecCtx, run);
        checkAborted(codecCtx, 'stream');
        return run.runExecute(exec, () => this.runExecute(exec));
      },
    );
  }

  async #readDriverStatistics(exec: MongoExecutionPlan): Promise<RuntimeStatementStats> {
    if (this.#closed) {
      throw runtimeClosedError();
    }
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
    this.#closed = true;
    await this.#driver.close();
  }
}

export function createMongoRuntime(options: MongoRuntimeOptions): MongoRuntime {
  return new MongoRuntimeImpl(options);
}

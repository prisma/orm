import { blindCast } from '@internal/utils/casts';
import type { CodecCallContext } from '../shared/codec-types';
import { AsyncIterableResult } from './async-iterable-result';
import type { ExecutionPlan, QueryPlan } from './query-plan';
import { checkAborted } from './race-against-abort';
import { executeStatement, streamStatement } from './run-with-middleware';
import type {
  ActivityContext,
  ActivityContextFields,
  RuntimeExecuteOptions,
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeStatementStats,
} from './runtime-middleware';

/**
 * Constructor options shared by every concrete `RuntimeCore` subclass. `ctx` holds the context fields every statement's activity context starts from.
 */
export interface RuntimeCoreOptions<TMiddleware extends RuntimeMiddleware<ExecutionPlan>> {
  readonly middleware: ReadonlyArray<TMiddleware>;
  readonly ctx: ActivityContextFields;
}

/**
 * Family-agnostic abstract runtime base. Each `query()` and `execute()` call is one statement activity, run in this order: `activityStarted`, `runBeforeCompile`, `lower`, `beforeEncode`, `intercept`, the driver with `onRow`, `activityEnded`, then `activityFinalized`. It has no parent, so it is finalized right after it ends.
 *
 * Concrete subclasses implement `lower`, `runDriver`, `runExecute` and `close`.
 */
export abstract class RuntimeCore<
  TPlan extends QueryPlan,
  TExec extends ExecutionPlan,
  TMiddleware extends RuntimeMiddleware<TExec>,
> implements RuntimeExecutor<TPlan>
{
  protected readonly middleware: ReadonlyArray<TMiddleware>;
  protected readonly ctx: ActivityContextFields;

  constructor(options: RuntimeCoreOptions<TMiddleware>) {
    this.middleware = [...options.middleware];
    this.ctx = options.ctx;
  }

  /** Pre-lowering hook for plan rewriting. Defaults to identity. */
  protected runBeforeCompile(plan: TPlan): TPlan | Promise<TPlan> {
    return plan;
  }

  /** Lowers a `TPlan` into the family's executable `TExec`, forwarding `ctx` to the encode-side codecs. */
  protected abstract lower(plan: TPlan, ctx: CodecCallContext): TExec | Promise<TExec>;

  /** Drives the transport for a lowered `TExec`, yielding raw rows. */
  protected abstract runDriver(exec: TExec): AsyncIterable<Record<string, unknown>>;

  protected abstract runExecute(exec: TExec): Promise<RuntimeStatementStats>;

  abstract close(): Promise<void>;

  query<Row>(
    plan: TPlan & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    const self = this;
    const codecCtx = codecContextOf(options);
    const statement = streamStatement(
      {
        middleware: this.middleware,
        plan,
        context: this.contextFieldsFor(codecCtx, options),
        parent: undefined,
      },
      async function* (run) {
        checkAborted(codecCtx, 'stream');
        const compiled = await self.runBeforeCompile(plan);
        const exec = await self.lower(compiled, codecCtx);
        await run.beforeEncode(exec);
        yield* run.runQuery(exec, () =>
          blindCast<
            AsyncIterable<Row>,
            'the caller types rows through the plan; the runtime treats them as opaque records'
          >(self.runDriver(exec)),
        );
      },
    );

    async function* generator(): AsyncGenerator<Row, void, unknown> {
      yield* statement;
    }
    return new AsyncIterableResult(generator());
  }

  execute(plan: TPlan, options?: RuntimeExecuteOptions): Promise<RuntimeStatementStats> {
    const codecCtx = codecContextOf(options);
    return executeStatement(
      {
        middleware: this.middleware,
        plan,
        context: this.contextFieldsFor(codecCtx, options),
        parent: undefined,
      },
      async (run) => {
        checkAborted(codecCtx, 'stream');
        const compiled = await this.runBeforeCompile(plan);
        const exec = await this.lower(compiled, codecCtx);
        await run.beforeEncode(exec);
        return run.runExecute(exec, () => this.runExecute(exec));
      },
    );
  }

  private contextFieldsFor(
    codecCtx: CodecCallContext,
    options: RuntimeExecuteOptions | undefined,
  ): ActivityContextFields<ActivityContext> {
    return { ...this.ctx, ...codecCtx, scope: options?.scope ?? this.ctx.scope };
  }
}

function codecContextOf(options: RuntimeExecuteOptions | undefined): CodecCallContext {
  const signal = options?.signal;
  return signal === undefined ? {} : { signal };
}

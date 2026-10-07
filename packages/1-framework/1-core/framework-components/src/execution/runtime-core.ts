import { blindCast } from '@internal/utils/casts';
import type { CodecCallContext } from '../shared/codec-types';
import { AsyncIterableResult } from './async-iterable-result';
import { runBeforeExecuteChain, runBeforeQueryChain } from './before-execute-chain';
import type { ExecutionPlan, QueryPlan } from './query-plan';
import { checkAborted } from './race-against-abort';
import {
  onQueryEndOutsideTransaction,
  reportExecuteEnding,
  reportQueryEnding,
  runAfterTransaction,
  runExecuteWithMiddleware,
  runQueryWithMiddleware,
} from './run-with-middleware';
import type {
  AfterTransactionResult,
  RuntimeExecuteOptions,
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
  RuntimeStatementStats,
} from './runtime-middleware';

/**
 * Constructor options shared by every concrete `RuntimeCore` subclass.
 *
 * Family runtimes typically build the middleware list and the
 * `RuntimeMiddlewareContext` themselves (running compatibility checks,
 * narrowing the context's `contract` field, etc.) before calling `super`.
 */
export interface RuntimeCoreOptions<TMiddleware extends RuntimeMiddleware<ExecutionPlan>> {
  readonly middleware: ReadonlyArray<TMiddleware>;
  readonly ctx: RuntimeMiddlewareContext;
}

/**
 * Family-agnostic abstract runtime base.
 *
 * Defines the shared operation-specific middleware lifecycles:
 *
 * 1. `runBeforeCompile(plan)` — concrete; defaults to identity. SQL overrides
 *    this to run its shared `beforeCompile` middleware-hook chain.
 * 2. `lower(plan)` — abstract. Each family produces its `*ExecutionPlan`
 *    (SQL via `lowerSqlPlan`, Mongo via `adapter.lower`).
 * 3. Queries run `beforeQuery`; statements run `beforeExecute`. Both chains
 *    run after lowering and before their matching driver terminal. Family
 *    runtimes that expose a params mutator to downstream encoding override
 *    the operation and call the matching helper at the pre-encode point.
 * 4. The matching runner processes `interceptQuery` or `interceptExecute`
 *    before invoking the driver. Queries then fire `onRow` and `afterQuery`;
 *    statements fire `afterExecute`.
 * 5. Every operation whose lowering (which encodes parameters) and before-hooks
 *    succeeded fires `afterTransaction` once, as its last hook: `committed`
 *    when it completed, `unknown` when it threw or the caller stopped reading
 *    its rows. `reportQueryEnding` and `reportExecuteEnding` report how the
 *    operation ended, and `onQueryEndOutsideTransaction` turns that into the
 *    outcome; family runtimes that override `query` or `execute` call them
 *    too, with {@link afterTransactionStageFor}.
 *
 * Concrete subclasses must implement `lower`, `runDriver`, `runExecute`, and
 * `close`.
 *
 * The class is generic over:
 * - `TPlan` — the family's pre-lowering plan type.
 * - `TExec` — the family's post-lowering (executable) plan type.
 * - `TMiddleware` — the family's middleware type. Constrained to
 *   `RuntimeMiddleware<TExec>` because the operation-specific runners invoke
 *   hooks with the lowered `TExec`. Middleware therefore sees the
 *   post-lowering plan.
 */
export abstract class RuntimeCore<
  TPlan extends QueryPlan,
  TExec extends ExecutionPlan,
  TMiddleware extends RuntimeMiddleware<TExec>,
> implements RuntimeExecutor<TPlan>
{
  protected readonly middleware: ReadonlyArray<TMiddleware>;
  protected readonly ctx: RuntimeMiddlewareContext;
  protected readonly anyMiddlewareDeclaresAfterTransaction: boolean;

  constructor(options: RuntimeCoreOptions<TMiddleware>) {
    this.middleware = [...options.middleware];
    this.ctx = options.ctx;
    this.anyMiddlewareDeclaresAfterTransaction = this.middleware.some(
      (mw) => mw.afterTransaction !== undefined,
    );
  }

  /**
   * Returns the function that runs every middleware's `afterTransaction` hook for one operation with a given result, or `undefined` when no middleware declared the hook when the runtime was created.
   */
  protected afterTransactionStageFor(
    exec: TExec,
    ctx: RuntimeMiddlewareContext,
  ): ((result: AfterTransactionResult) => Promise<void>) | undefined {
    if (!this.anyMiddlewareDeclaresAfterTransaction) return undefined;
    return (result) => runAfterTransaction(exec, this.middleware, result, ctx);
  }

  /**
   * Pre-lowering hook for plan rewriting. Defaults to identity. Subclasses
   * may override to run a `beforeCompile` middleware chain (SQL does this
   * to support typed AST rewrites — see `before-compile-chain.ts`).
   */
  protected runBeforeCompile(plan: TPlan): TPlan | Promise<TPlan> {
    return plan;
  }

  /**
   * Lower a pre-lowering `TPlan` into the family's executable `TExec`.
   * Family-specific: SQL produces `{ sql, params, ast?, ... }`; Mongo
   * produces `{ command, ... }`.
   *
   * `ctx` carries per-operation cancellation (and any future fields on
   * `CodecCallContext`); concrete subclasses forward it to the encode-side
   * codec dispatch site. The runtime allocates one ctx per operation call
   * and threads the same reference everywhere; the
   * `signal` field inside may be `undefined`, but the ctx object itself
   * is always present.
   */
  protected abstract lower(plan: TPlan, ctx: CodecCallContext): TExec | Promise<TExec>;

  /**
   * Drive the underlying transport for a lowered `TExec`. Yields raw rows
   * directly from the driver as `Record<string, unknown>`; codec decoding
   * (if any) is the subclass's responsibility, applied by wrapping
   * `query()` rather than living inside this hook.
   *
   * The `Row` type parameter on `query()` is satisfied by the caller via
   * the plan's phantom `_row`; the runtime treats rows as opaque records
   * here and trusts the caller's row typing.
   */
  protected abstract runDriver(exec: TExec): AsyncIterable<Record<string, unknown>>;

  protected abstract runExecute(exec: TExec): Promise<RuntimeStatementStats>;

  abstract close(): Promise<void>;

  query<Row>(
    plan: TPlan & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row> {
    const self = this;
    const signal = options?.signal;
    const codecCtx: CodecCallContext = signal === undefined ? {} : { signal };
    const execCtx: RuntimeMiddlewareContext = {
      ...self.ctx,
      ...codecCtx,
      scope: options?.scope ?? self.ctx.scope,
      planExecutionId: crypto.randomUUID(),
    };

    async function* generator(): AsyncGenerator<Row, void, unknown> {
      checkAborted(codecCtx, 'stream');
      const compiled = await self.runBeforeCompile(plan);
      const exec = await self.lower(compiled, codecCtx);
      await runBeforeQueryChain<TExec>(exec, self.middleware, execCtx);
      const onQueryEnd = onQueryEndOutsideTransaction(self.afterTransactionStageFor(exec, execCtx));
      yield* reportQueryEnding(onQueryEnd, () =>
        runQueryWithMiddleware<TExec, Row>(exec, self.middleware, execCtx, () =>
          blindCast<
            AsyncIterable<Row>,
            'the caller types rows through the plan; the runtime treats them as opaque records'
          >(self.runDriver(exec)),
        ),
      );
    }

    return new AsyncIterableResult(generator());
  }

  async execute(plan: TPlan, options?: RuntimeExecuteOptions): Promise<RuntimeStatementStats> {
    const signal = options?.signal;
    const codecCtx: CodecCallContext = signal === undefined ? {} : { signal };
    const execCtx: RuntimeMiddlewareContext = {
      ...this.ctx,
      ...codecCtx,
      scope: options?.scope ?? this.ctx.scope,
      planExecutionId: crypto.randomUUID(),
    };

    checkAborted(codecCtx, 'stream');
    const compiled = await this.runBeforeCompile(plan);
    const exec = await this.lower(compiled, codecCtx);
    await runBeforeExecuteChain<TExec>(exec, this.middleware, execCtx);
    const onQueryEnd = onQueryEndOutsideTransaction(this.afterTransactionStageFor(exec, execCtx));
    return reportExecuteEnding(onQueryEnd, () =>
      runExecuteWithMiddleware(exec, this.middleware, execCtx, () => this.runExecute(exec)),
    );
  }
}

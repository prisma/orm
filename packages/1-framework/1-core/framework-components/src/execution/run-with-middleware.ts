import { blindCast } from '@internal/utils/casts';
import { AsyncIterableResult } from './async-iterable-result';
import type { ExecutionPlan } from './query-plan';
import type {
  AfterQueryResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
  RuntimeStatementStats,
} from './runtime-middleware';

/**
 * Drives a single query execution of `runDriver()` through the middleware
 * lifecycle's `interceptQuery` + row-source + termination phases.
 *
 * Lifecycle, in order:
 *  1. For each middleware in registration order: `interceptQuery(exec, ctx)`.
 *     The first non-`undefined` result wins; subsequent middleware's
 *     `interceptQuery` does not fire. On a hit, the runtime emits a
 *     `middleware.interceptQuery` debug event naming the winning middleware,
 *     switches the row source to the intercepted rows, and proceeds with
 *     `source: 'middleware'`. On all-passthrough (every `interceptQuery`
 *     returns `undefined` or is omitted), `source: 'driver'` is used and the
 *     row source is `runDriver()`.
 *  2. Iterate the row source. On the driver path, for each row, for each
 *     middleware in registration order: `onRow(row, exec, ctx)`; then yield
 *     the row. On the intercepted hit path, `onRow` is skipped — intercepted
 *     rows did not originate from a driver row stream — but rows are still
 *     yielded to the consumer in order.
 *  3. On successful completion: for each middleware in registration order:
 *     `afterQuery(exec, { rowCount, latencyMs, completed: true, source },
 *     ctx)`.
 *  4. On any error thrown during steps 1–2: for each middleware in
 *     registration order: `afterQuery(exec, { rowCount, latencyMs,
 *     completed: false, source, error }, ctx)`, where `error` is the caught
 *     value. Errors thrown by `afterQuery` during the error path are
 *     swallowed so they do not mask the original error. The original error
 *     is then rethrown.
 *
 * `beforeQuery` is **not** fired here — see
 * {@link runBeforeQueryChain} in `before-execute-chain.ts`. Family runtimes
 * call that helper between the AST → plan lowering step and the parameter
 * encode step so middleware that mutates ParamRef values can have its
 * mutations visible to encode. `runQueryWithMiddleware` operates on the
 * fully-encoded plan; interceptors therefore observe a fully-mutated,
 * encoded plan.
 *
 * The `source` field on `AfterQueryResult` lets observers (telemetry, lints,
 * budgets) distinguish driver-served from middleware-served executions
 * without needing their own out-of-band signal.
 *
 * This helper is the single canonical implementation of the
 * intercept-and-row-source loop; family runtimes should not reimplement it.
 */
export function runQueryWithMiddleware<TExec extends ExecutionPlan, Row>(
  exec: TExec,
  middleware: ReadonlyArray<RuntimeMiddleware<TExec>>,
  ctx: RuntimeMiddlewareContext,
  runDriver: () => AsyncIterable<Row>,
): AsyncIterableResult<Row> {
  const iterator = async function* (): AsyncGenerator<Row, void, unknown> {
    const startedAt = Date.now();
    let rowCount = 0;
    let source: 'driver' | 'middleware' = 'driver';
    // Deferred so a winning interceptor can skip `runDriver()` entirely.
    // For factories that lazily produce async generators this is a no-op,
    // but factories that do eager work (e.g. acquiring a connection,
    // sending a query) must not run on the intercepted hit path.
    let rowSource: AsyncIterable<Row> | Iterable<Row> | undefined;

    try {
      for (const mw of middleware) {
        if (!mw.interceptQuery) continue;
        // Mark the lifecycle as middleware-driven *before* awaiting the
        // hook. If `interceptQuery` throws, the catch block reports the
        // failure as `source: 'middleware'` — the failure originated in the
        // intercept chain, not in the driver. If `interceptQuery` returns
        // `undefined` (passthrough), we revert to `'driver'` and continue.
        source = 'middleware';
        const result = await mw.interceptQuery(exec, ctx);
        if (result === undefined) {
          source = 'driver';
          continue;
        }
        ctx.log.debug?.({ event: 'middleware.interceptQuery', middleware: mw.name });
        // The intercepted rows are typed as `Record<string, unknown>` at
        // the SPI level; the consumer's `Row` type parameter is enforced by
        // the caller (via the plan's phantom `_row`) the same way driver
        // rows are. The narrow cast bridges the SPI shape to the
        // caller-supplied Row.
        rowSource = blindCast<
          AsyncIterable<Row> | Iterable<Row>,
          'intercepted rows are supplied as the runtime operation row type'
        >(result.rows);
        break;
      }

      if (source === 'driver') rowSource = runDriver();

      // `rowSource` is always assigned by this point: either the intercepted
      // rows (on a hit) or `runDriver()` (on the driver path).
      for await (const row of rowSource as AsyncIterable<Row> | Iterable<Row>) {
        if (source === 'driver') {
          for (const mw of middleware) {
            if (mw.onRow) {
              await mw.onRow(row as Record<string, unknown>, exec, ctx);
            }
          }
        }
        rowCount++;
        yield row;
      }
    } catch (error) {
      await notifyQueryFailure(middleware, exec, ctx, {
        rowCount,
        latencyMs: Date.now() - startedAt,
        completed: false,
        source,
        error,
      });
      throw error;
    }

    const result: AfterQueryResult = {
      rowCount,
      latencyMs: Date.now() - startedAt,
      completed: true,
      source,
    };
    for (const mw of middleware) {
      if (mw.afterQuery) await mw.afterQuery(exec, result, ctx);
    }
  };

  return new AsyncIterableResult(iterator());
}

/**
 * Drives a single execute operation through the middleware
 * `interceptExecute` + statistics + termination phases.
 *
 * Lifecycle, in order:
 *  1. For each middleware in registration order: `interceptExecute(exec, ctx)`.
 *     The first non-`undefined` result wins; subsequent middleware's
 *     `interceptExecute` does not fire. On a hit, the runtime emits a
 *     `middleware.interceptExecute` debug event naming the winning middleware,
 *     uses the returned `stats`, and proceeds with `source: 'middleware'`.
 *     On all-passthrough (every `interceptExecute` returns `undefined` or is
 *     omitted), `source: 'driver'` is used and `runDriver()` supplies the
 *     statistics.
 *  2. Execute operations return eager statistics. There is no row stream and
 *     `onRow` does not fire.
 *  3. On successful completion: for each middleware in registration order:
 *     `afterExecute(exec, { stats, latencyMs, completed: true, source }, ctx)`.
 *  4. On any error thrown during steps 1–2: for each middleware in
 *     registration order: `afterExecute(exec, { latencyMs, completed: false,
 *     source, error }, ctx)`, where `error` is the caught value. Errors
 *     thrown by `afterExecute` during the error path are swallowed so they
 *     do not mask the original error. The original error is then rethrown.
 *
 * `beforeExecute` is **not** fired here — see
 * {@link runBeforeExecuteChain} in `before-execute-chain.ts`. Family runtimes
 * call that helper between the AST → plan lowering step and the parameter
 * encode step so middleware that mutates ParamRef values can have its
 * mutations visible to encode. `runExecuteWithMiddleware` operates on the
 * fully-encoded plan; interceptors therefore observe a fully-mutated,
 * encoded plan.
 *
 * The `source` field on `AfterExecuteResult` lets observers (telemetry, lints,
 * budgets) distinguish driver-served from middleware-served executions
 * without needing their own out-of-band signal.
 */
export async function runExecuteWithMiddleware<TExec extends ExecutionPlan>(
  exec: TExec,
  middleware: ReadonlyArray<RuntimeMiddleware<TExec>>,
  ctx: RuntimeMiddlewareContext,
  runDriver: () => Promise<RuntimeStatementStats>,
): Promise<RuntimeStatementStats> {
  const startedAt = Date.now();
  let source: 'driver' | 'middleware' = 'driver';
  let stats: RuntimeStatementStats | undefined;

  try {
    for (const mw of middleware) {
      if (!mw.interceptExecute) continue;
      source = 'middleware';
      const result = await mw.interceptExecute(exec, ctx);
      if (result === undefined) {
        source = 'driver';
        continue;
      }
      ctx.log.debug?.({ event: 'middleware.interceptExecute', middleware: mw.name });
      stats = result.stats;
      break;
    }

    if (stats === undefined) {
      stats = await runDriver();
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    for (const mw of middleware) {
      if (!mw.afterExecute) continue;
      try {
        await mw.afterExecute(exec, { latencyMs, completed: false, source, error }, ctx);
      } catch {
        // Preserve the operation error when completion observers also fail.
      }
    }
    throw error;
  }

  const latencyMs = Date.now() - startedAt;
  for (const mw of middleware) {
    if (mw.afterExecute) {
      await mw.afterExecute(exec, { stats, latencyMs, completed: true, source }, ctx);
    }
  }
  return stats;
}

async function notifyQueryFailure<TExec extends ExecutionPlan>(
  middleware: ReadonlyArray<RuntimeMiddleware<TExec>>,
  exec: TExec,
  ctx: RuntimeMiddlewareContext,
  result: AfterQueryResult & { readonly completed: false },
): Promise<void> {
  for (const mw of middleware) {
    if (!mw.afterQuery) continue;
    try {
      await mw.afterQuery(exec, result, ctx);
    } catch {
      // Preserve the operation error when completion observers also fail.
    }
  }
}

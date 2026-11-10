import type { DraftPlan, SqlMiddleware, SqlMiddlewareContext } from './sql-middleware';

export async function runBeforeCompileChain(
  middleware: readonly SqlMiddleware[],
  initial: DraftPlan,
  ctx: SqlMiddlewareContext,
): Promise<DraftPlan> {
  let current = initial;
  for (const mw of middleware) {
    if (!mw.beforeCompile) {
      continue;
    }
    const result = await mw.beforeCompile(current, ctx);
    if (result === undefined) {
      continue;
    }
    if (result.ast === current.ast) {
      continue;
    }
    ctx.log.debug?.({
      event: 'middleware.rewrite',
      middleware: mw.name,
      lane: current.meta.lane,
    });
    current = result;
  }

  return current;
}

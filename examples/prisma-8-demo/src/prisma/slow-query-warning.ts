/**
 * Custom middleware example: warn when a statement runs longer than a threshold.
 *
 * `beforeEncode` keeps the lowered SQL in the statement's `ctx.state`, and `activityEnded` fires once the statement ends — whether its rows came from the driver or from an `intercept` hit (`result.source` says which) — with the observed `latencyMs`. Registered on the runtime in `src/prisma/db.ts` via the `middleware: [...]` option.
 */
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';

export interface SlowQueryWarningOptions {
  /** Latency above this many milliseconds logs a warning. Default: 250. */
  readonly thresholdMs?: number;
}

const statementSql = Symbol('slow-query-warning.sql');

export function slowQueryWarning(options?: SlowQueryWarningOptions): SqlMiddleware {
  const thresholdMs = options?.thresholdMs ?? 250;

  return {
    name: 'slow-query-warning',
    familyId: 'sql',

    async beforeEncode(plan, ctx) {
      ctx.state(statementSql)['sql'] = plan.sql;
    },

    async activityEnded(activity, result, ctx) {
      if (result.kind !== 'statement' || result.latencyMs <= thresholdMs) return;
      ctx.log.warn({
        code: 'APP.SLOW_QUERY',
        message: `Query took ${result.latencyMs}ms (threshold: ${thresholdMs}ms)`,
        details: {
          sql: ctx.state(statementSql)['sql'],
          ...(result.returns === 'rows' ? { rowCount: result.rowCount } : {}),
          latencyMs: result.latencyMs,
          source: result.source,
          activityId: activity.id,
        },
      });
    },
  };
}

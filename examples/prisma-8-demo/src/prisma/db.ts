import { createCacheMiddleware } from '@prisma/orm-extension-middleware-cache';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import { budgets, lints } from '@prisma/orm-postgres/family-runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { engagementStatsRuntime } from '../extensions/engagement-stats';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };
import { slowQueryWarning } from './slow-query-warning';

export const db = postgres<Contract>({
  contractJson,
  // The runtime half of the `stddev` contribution; its control half is
  // composed in `prisma.config.ts`, where the emitted types come from.
  extensions: [pgvector, engagementStatsRuntime],
  middleware: [
    // Cache first: interceptors are consulted in registration order and
    // the first non-`undefined` result wins, so the cache gets first
    // claim. A hit skips only the driver call and per-row `onRow` hooks:
    // every middleware's `beforeQuery` (`lints`, `budgets`) has already
    // run before any `interceptQuery` is consulted, and `afterQuery` still
    // fires for all of them with `source: 'middleware'`. The cache stores
    // raw rows; the runtime still runs `decodeRow` on the hit path, so
    // consumers see decoded values in both cases.
    createCacheMiddleware(),
    lints(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
    // Custom middleware (see `slow-query-warning.ts`): observes every
    // execution's latency via `afterQuery` and logs a warning past the
    // threshold. Cache hits flow through it too, with `source: 'middleware'`.
    slowQueryWarning({ thresholdMs: 250 }),
  ],
});

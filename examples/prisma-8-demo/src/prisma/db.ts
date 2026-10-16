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
    // the first non-`undefined` result wins, so the cache gets first claim.
    // An annotated ORM read is cached as a whole call, keyed by the
    // annotation's `key` or the call's content hash. On a hit no statement
    // runs, so `lints`, `budgets` and the slow-query warning see nothing.
    // An annotated SQL builder query is cached as raw rows: a hit skips the
    // driver call and `onRow`, but `beforeEncode` hooks have already run.
    createCacheMiddleware(),
    lints(),
    budgets({
      maxRows: 10_000,
      defaultTableRows: 10_000,
      tableRows: { user: 10_000, post: 10_000 },
      maxLatencyMs: 1_000,
    }),
    // Custom middleware (see `slow-query-warning.ts`): observes every
    // statement's latency via `activityEnded` and logs a warning past the
    // threshold. A cached SQL builder query reaches it with
    // `source: 'middleware'`; a cached ORM call sends no statement.
    slowQueryWarning({ thresholdMs: 250 }),
  ],
});

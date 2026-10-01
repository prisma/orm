/**
 * Cached `User.first({ id })` lookup.
 *
 * Demonstrates the read-only `cacheAnnotation` from
 * `@internal/middleware-cache`. The annotation is opt-in: the cache
 * middleware only acts on plans whose `meta.annotations` carry a
 * `cacheAnnotation`. Calling the same lookup with the same `id` while the
 * entry lives (60 seconds in the default store configured in
 * `src/prisma/db.ts`) is served from the cache — the driver is **not**
 * invoked the second time.
 *
 * The cache key is composed by the runtime via
 * `RuntimeMiddlewareContext.contentHash(exec)`, which incorporates the
 * post-lowering SQL plus parameters. Two lookups for different `id`
 * values therefore land in different cache slots; the same `id` hits.
 *
 * Notes worth pinning:
 *
 * - `cacheAnnotation` declares `applicableTo: ['read']`. Passing it to
 *   a write terminal (`create`, `update`, `delete`) is a type error
 *   *and* a runtime error — it cannot be smuggled through with a cast
 *   on one side without failing on the other.
 * - On a cache hit, every registered middleware's `afterQuery` still
 *   fires and reports `source: 'middleware'` — the `slowQueryWarning`
 *   middleware in `db.ts` observes cached reads too — so observability
 *   is preserved even though the driver is skipped.
 * - Schema migrations rotate `meta.storageHash`, which feeds
 *   `contentHash`, so cached entries from a previous schema cannot
 *   accidentally serve queries against the new schema.
 */

import { cacheAnnotation } from '@prisma/orm-extension-middleware-cache';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserId = DefaultModelRow<Contract, 'User'>['id'];

export interface CachedLookupOptions {
  /**
   * When `true`, the cache middleware neither reads from nor writes to
   * the cache for this call. Useful as a "force refresh" knob without
   * removing the annotation entirely.
   */
  readonly forceRefresh?: boolean;
}

export async function ormClientFindUserByIdCached(
  id: string,
  runtime: Runtime,
  options: CachedLookupOptions = {},
) {
  const db = createOrmClient(runtime);
  return db.User.first({ id: toUserId(id) }, (meta) =>
    meta.annotate(cacheAnnotation({ bypass: options.forceRefresh ?? false })),
  );
}

function toUserId(value: string): UserId {
  return value as UserId;
}

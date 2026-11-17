/**
 * Cached `User.first({ id })` lookup.
 *
 * Demonstrates the read-only `cacheAnnotation` from
 * `@internal/middleware-cache`. The annotation is opt-in: the ORM call
 * carries it on its `orm-call` activity, and the cache middleware caches
 * the call as a whole. Calling the same lookup with the same `id` while
 * the entry lives (60 seconds in the default store configured in
 * `src/prisma/db.ts`) is served from the cache — the ORM sends **no**
 * statement the second time.
 *
 * The cache key is `userCacheKey(id)`, so a write can name it:
 * `ormClientUpdateUserEmailInvalidatingCache` removes it with
 * `invalidateAnnotation` once the update commits. Two lookups for
 * different `id` values land in different cache slots; the same `id` hits.
 *
 * Notes worth pinning:
 *
 * - `cacheAnnotation` declares `applicableTo: ['read']`. Passing it to
 *   a write terminal (`create`, `update`, `delete`) is a type error
 *   *and* a runtime error — it cannot be smuggled through with a cast
 *   on one side without failing on the other.
 * - On a cache hit no statement runs, so statement middleware such as
 *   `slowQueryWarning` in `db.ts` sees nothing; the call's own
 *   `activityEnded` fires with `source: 'middleware'`.
 * - The explicit key does not change with `meta.storageHash`, so after a
 *   schema migration it can serve an entry cached under the old schema
 *   until the entry expires. With a store shared across deploys, prefix
 *   the key with something tied to the schema, such as the storage hash.
 */

import { cacheAnnotation } from '@prisma/orm-extension-middleware-cache';
import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';
import type { DemoOrm } from '../prisma/db';

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
  orm: DemoOrm,
  options: CachedLookupOptions = {},
) {
  return orm.User.first({ id: toUserId(id) }, (meta) =>
    meta.annotate(
      cacheAnnotation({ key: userCacheKey(id), bypass: options.forceRefresh ?? false }),
    ),
  );
}

export function toUserId(value: string): UserId {
  return value as UserId;
}

/** The key `ormClientFindUserByIdCached` stores user `id` under. */
export function userCacheKey(id: string): string {
  return `user:${id}`;
}

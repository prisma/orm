/**
 * Cached `User.all()` listing.
 *
 * Companion to `find-user-by-id-cached.ts` — same opt-in caching
 * mechanism, this time on a multi-row read terminal. The terminal's
 * `configure: (meta) => void` callback hands the caller a
 * `MetaBuilder<'read'>`; calling `meta.annotate(cacheAnnotation({ ttl }))`
 * enables caching of the post-lowering execution.
 *
 * The example also shows the per-query `key` override. When set, the
 * supplied string is used verbatim as the cache key; the cache
 * middleware does not rehash it. This is useful for sharing entries
 * across slightly different plans whose results you know to be
 * equivalent (e.g. the same user list rendered through two different
 * `select` shapes), but the trade-off is that you take responsibility
 * for keeping the key bounded and free of sensitive data — the
 * default `contentHash(exec)` digest is a SHA-512 hash with no
 * such risks.
 */

import { cacheAnnotation } from '@prisma/orm-extension-middleware-cache';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export interface CachedListOptions {
  readonly ttlMs?: number;
  /**
   * Optional override for the cache key. When omitted, the runtime's
   * `contentHash(exec)` is used (the default and recommended path).
   */
  readonly key?: string;
}

export async function ormClientGetUsersCached(
  limit: number,
  runtime: Runtime,
  options: CachedListOptions = {},
) {
  const db = createOrmClient(runtime);
  const ttl = options.ttlMs ?? 60_000;
  return db.User.limit(limit).all((meta) =>
    meta.annotate(cacheAnnotation(options.key !== undefined ? { ttl, key: options.key } : { ttl })),
  );
}

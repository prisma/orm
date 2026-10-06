/**
 * Cached SQL DSL `select` example.
 *
 * Mirrors `get-users.ts` but adds `.annotate(cacheAnnotation(...))`
 * to opt the plan into the cache middleware registered on the runtime
 * in `src/prisma/db.ts`. The annotation is a read-only handle, so the
 * type system rejects passing it to write builders (`insert`,
 * `update`, `delete`); the runtime gate fails closed for callers that
 * bypass the type check with a cast.
 *
 * The cache key is computed by the runtime via
 * `RuntimeMiddlewareContext.contentHash(exec)` — the post-lowering
 * statement plus parameters, hashed to a bounded SHA-512 digest.
 * Subsequent calls with the same plan while the entry lives are
 * served from the cache without invoking the driver.
 */
import { cacheAnnotation } from '@prisma/orm-extension-middleware-cache';
import { db } from '../prisma/db';

export async function getUsersCached(limit = 10) {
  const plan = db.sql.public.user
    .select('id', 'email', 'createdAt', 'kind')
    .annotate(cacheAnnotation({}))
    .limit(limit)
    .build();
  return db.runtime().query(plan);
}

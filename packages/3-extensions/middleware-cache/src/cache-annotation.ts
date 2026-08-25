import { defineAnnotation } from '@internal/framework-components/runtime';

/**
 * Payload accepted when calling the `cacheAnnotation` handle.
 *
 * - `ttl` — Time-to-live for the cached entry, in milliseconds. When
 *   omitted, the cache middleware passes the query through untouched —
 *   presence of the annotation alone is not sufficient to enable caching.
 *   This makes the cache strictly opt-in per query.
 * - `skip` — When `true`, the cache middleware passes the query through
 *   untouched even if a `ttl` is set. Useful for selectively bypassing
 *   the cache on a per-call basis without removing the annotation
 *   entirely (e.g. a "force refresh" knob in user code).
 * - `key` — Per-query override of the cache key. When supplied, replaces
 *   the default `RuntimeMiddlewareContext.contentHash(exec)` digest.
 *   The supplied string is stored as-is — the cache middleware does
 *   **not** rehash it, so the caller is responsible for ensuring the
 *   string is bounded in size and free of sensitive data they do not
 *   want flowing into logs / Redis `KEYS` / persistence dumps.
 * - `dedupe` — Per-query toggle for in-process miss deduplication
 *   (single-flight). When `true`, concurrent identical misses for the
 *   same effective key in the same process share one leader execution;
 *   followers wait for the leader's result. When `false`, each miss
 *   executes independently.
 * - `tags` — Optional list of cache tags to associate with this entry.
 *   Tags enable bulk cache invalidation: uncache by tag(s) will clear
 *   all entries that have those tags, regardless of key pattern.
 */
export interface CachePayload {
  readonly enabled?: boolean;
  readonly ttl?: number;
  readonly skip?: boolean;
  readonly key?: string;
  readonly namespace?: string;
  readonly dedupe?: boolean;
  readonly tags?: readonly string[];
  readonly store?: string;
}

/**
 * Read-only annotation handle for the cache middleware.
 *
 * Declared with `applicableTo: ['read']`. Write terminals supply
 * `K = 'write'` to the type-level `ValidAnnotations<'write', As>` gate
 * (and the runtime `assertAnnotationsApplicable(annotations, 'write', ...)`
 * check); the join `K extends Kinds` fails for this annotation, making
 * "cache a mutation" structurally impossible without an `as any` cast
 * bypass at both type *and* runtime levels.
 *
 * Stored under namespace `'cache'` in `plan.meta.annotations`. The cache
 * middleware reads it via `cacheAnnotation.read(plan)`.
 *
 * @example
 * ```typescript
 * import { cacheAnnotation } from '@internal/middleware-cache';
 *
 * // ORM read terminal — accepts the read-only annotation via the meta callback.
 * const user = await db.User.first(
 *   { id },
 *   (meta) => meta.annotate(cacheAnnotation({ ttl: 60_000 })),
 * );
 *
 * // SQL DSL select builder — chainable.
 * const plan = db.sql
 *   .from(tables.user)
 *   .annotate(cacheAnnotation({ ttl: 60_000 }))
 *   .select({ id: tables.user.columns.id })
 *   .build();
 * ```
 */
export const cacheAnnotation = defineAnnotation<CachePayload>()({
  namespace: 'cache',
  applicableTo: ['read'],
});

import {
  type AnnotationHandle,
  type AnnotationValue,
  defineAnnotation,
} from '@internal/framework-components/runtime';

/**
 * Options for a read annotated with `cacheAnnotation`. A read with the annotation, in runtime scope
 * and not bypassed, is cached; how long the entry lives is the store's policy.
 *
 * - `key` — the entry's key. When absent, the middleware's `deriveKey` computes it. The key is
 *   stored and logged as given, so keep it bounded and free of secrets.
 * - `meta` — any value, passed by reference to the store's `set` with the entry. The middleware
 *   never reads it. Stores use it to group entries (for example by tag) or to set a lifetime.
 * - `bypass` — when `true`, the read neither reads from nor writes to the cache.
 *
 * `TMeta` is the shape of `meta`; pass the store's `TMeta` so the two agree.
 */
export interface CacheAnnotationOptions<TMeta = unknown> {
  readonly key?: string | undefined;
  readonly meta?: TMeta | undefined;
  readonly bypass?: boolean | undefined;
}

/**
 * The type of `cacheAnnotation`: a call generic in `TMeta`, plus the read-only `namespace`,
 * `applicableTo` and `read` of the underlying annotation handle.
 */
export type CacheAnnotationHandle = (<TMeta = unknown>(
  options: CacheAnnotationOptions<TMeta>,
) => AnnotationValue<CacheAnnotationOptions, 'read'>) & {
  readonly namespace: string;
  readonly applicableTo: ReadonlySet<'read'>;
  readonly read: AnnotationHandle<CacheAnnotationOptions, 'read'>['read'];
};

/**
 * Marks a read for the cache middleware. It applies to reads only: a write terminal refuses it at
 * compile time and at run time. The middleware reads it from a statement plan's `meta.annotations.cache`, or from the annotations of a client activity, such as an ORM read, which is then cached as a whole.
 *
 * `TMeta` types `meta` for this call only. Nothing ties it to the store's `TMeta`, so a store
 * package should export a wrapper typed with its own meta, such as
 * `(o: CacheAnnotationOptions<TagMeta>) => cacheAnnotation<TagMeta>(o)`.
 *
 * @example
 * ```typescript
 * import { cacheAnnotation } from '@internal/middleware-cache';
 *
 * // ORM read terminal — accepts the read-only annotation via the meta callback.
 * const user = await db.orm.public.User.first(
 *   { id },
 *   (meta) => meta.annotate(cacheAnnotation({ key: `user-${id}` })),
 * );
 *
 * // SQL DSL select builder — chainable.
 * const plan = db.sql
 *   .from(tables.user)
 *   .annotate(cacheAnnotation({}))
 *   .select({ id: tables.user.columns.id })
 *   .build();
 * ```
 */
export const cacheAnnotation: CacheAnnotationHandle = withTypedMeta(
  defineAnnotation<CacheAnnotationOptions>()({ namespace: 'cache', applicableTo: ['read'] }),
);

function withTypedMeta(
  handle: AnnotationHandle<CacheAnnotationOptions, 'read'>,
): CacheAnnotationHandle {
  function cacheAnnotationWithMeta<TMeta = unknown>(
    options: CacheAnnotationOptions<TMeta>,
  ): AnnotationValue<CacheAnnotationOptions, 'read'> {
    return handle(options);
  }
  return Object.freeze(
    Object.assign(cacheAnnotationWithMeta, {
      namespace: handle.namespace,
      applicableTo: handle.applicableTo,
      read: handle.read,
    }),
  );
}

/**
 * What to invalidate: the argument of the cache middleware's `invalidate`, and the payload of `invalidateAnnotation`, which the middleware passes to the same call once the write's effects are final.
 *
 * `TMeta` is the shape of `meta`; pass the store's `TMeta` so the two agree.
 */
export interface InvalidationTarget<TMeta = unknown> {
  readonly keys?: readonly string[] | undefined;
  readonly meta?: TMeta | undefined;
}

/**
 * The type of `invalidateAnnotation`: a call generic in `TMeta`, plus the read-only `namespace`,
 * `applicableTo` and `read` of the underlying annotation handle.
 */
export type InvalidateAnnotationHandle = (<TMeta = unknown>(
  options: InvalidationTarget<TMeta>,
) => AnnotationValue<InvalidationTarget, 'write'>) & {
  readonly namespace: string;
  readonly applicableTo: ReadonlySet<'write'>;
  readonly read: AnnotationHandle<InvalidationTarget, 'write'>['read'];
};

/**
 * Marks a write whose cache entries the cache middleware invalidates once the write's effects are final: right after the write outside a transaction, or when the outermost enclosing transaction ends. It does not invalidate when the write is rolled back, and does when the outcome is unknown. It applies to writes only: a read terminal refuses it at compile time and at run time.
 *
 * `TMeta` types `meta` for this call only. Nothing ties it to the store's `TMeta`, so a store package should export a wrapper typed with its own meta, such as `(o: InvalidationTarget<TagMeta>) => invalidateAnnotation<TagMeta>(o)`.
 *
 * @example
 * ```typescript
 * await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' }, (meta) =>
 *   meta.annotate(invalidateAnnotation({ keys: ['user-1'] })),
 * );
 * ```
 */
export const invalidateAnnotation: InvalidateAnnotationHandle = withTypedInvalidateMeta(
  defineAnnotation<InvalidationTarget>()({
    namespace: 'cache-invalidate',
    applicableTo: ['write'],
  }),
);

function withTypedInvalidateMeta(
  handle: AnnotationHandle<InvalidationTarget, 'write'>,
): InvalidateAnnotationHandle {
  function invalidateAnnotationWithMeta<TMeta = unknown>(
    options: InvalidationTarget<TMeta>,
  ): AnnotationValue<InvalidationTarget, 'write'> {
    return handle(options);
  }
  return Object.freeze(
    Object.assign(invalidateAnnotationWithMeta, {
      namespace: handle.namespace,
      applicableTo: handle.applicableTo,
      read: handle.read,
    }),
  );
}

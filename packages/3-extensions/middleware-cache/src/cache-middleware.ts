import type {
  AfterQueryResult,
  CrossFamilyMiddleware,
  ExecutionPlan,
  RuntimeMiddlewareContext,
} from '@internal/framework-components/runtime';
import { cacheAnnotation } from './cache-annotation';
import {
  type CachedRows,
  type CacheEntry,
  type CacheStore,
  createInMemoryCacheStore,
} from './cache-store';

/**
 * Options accepted by `createCacheMiddleware`.
 *
 * - `store` — the cache backend. Defaults to `createInMemoryCacheStore()`: 1000 values, 60 s.
 * - `deriveKey` — computes the key of a cached read whose annotation has no `key`. Defaults to
 *   `deriveKeyFromContentHash`. It runs on every such read, hit or miss, and an error from it
 *   fails the read. It must return different keys whenever the rows can differ; build on
 *   `deriveKeyFromContentHash` to keep the statement, parameters and storage hash.
 *
 * `TMeta` is the store's meta type; `createCacheMiddleware` infers it from `store`. The store holds
 * `CachedRows`.
 */
export interface CacheMiddlewareOptions<TMeta = unknown> {
  readonly store?: CacheStore<TMeta, CachedRows>;
  readonly deriveKey?: (
    exec: ExecutionPlan,
    ctx: RuntimeMiddlewareContext,
  ) => string | Promise<string>;
}

/**
 * The cache middleware.
 *
 * `invalidate` removes entries through one `store.unset({ keys, meta })` call. It does nothing
 * when `keys` is empty or absent and `meta` is absent. The store moves the version of every key it
 * removes, so a read that missed before the call and finishes after it does not store its rows:
 * its conditional `store.set` returns `false`. This holds across processes that share a store. An
 * error from the store propagates.
 *
 * `TMeta` is the store's meta type, which `invalidate`'s `meta` must have.
 */
export type CacheMiddleware<TMeta = unknown> = CrossFamilyMiddleware & {
  readonly invalidate: (target: {
    readonly keys?: readonly string[];
    readonly meta?: TMeta;
  }) => Promise<void>;
};

/**
 * The default `deriveKey`: the family runtime's content hash of the plan, which covers the
 * statement, its parameters and the storage hash.
 */
export function deriveKeyFromContentHash(
  exec: ExecutionPlan,
  ctx: RuntimeMiddlewareContext,
): Promise<string> {
  return ctx.contentHash(exec);
}

/**
 * A cache miss in flight, keyed on the post-lowering `exec` object in a `WeakMap`. Family runtimes
 * build a fresh `exec` per call; the runtime subsystem doc records that invariant. `entry` is the
 * empty entry `store.get` returned; `store.set(entry, rows)` is conditional on its version.
 */
interface PendingMiss {
  readonly entry: CacheEntry<unknown, CachedRows>;
  readonly buffer: Record<string, unknown>[];
}

/**
 * Creates a read-through cache middleware that works with every family runtime.
 *
 * It caches a read when the plan carries `cacheAnnotation`, the annotation does not set
 * `bypass`, and the read runs in runtime scope (not inside a connection or transaction). The key
 * is the annotation's `key`, else `deriveKey(exec, ctx)`.
 *
 * - `interceptQuery` — on a hit, returns the stored rows and the driver does not run. On a miss,
 *   starts collecting rows.
 * - `onRow` — collects each row of a miss.
 * - `afterQuery` — when the driver completed the read, calls `store.set(entry, rows)` with the
 *   entry `store.get` returned, which stores only if the key's version has not moved. If an
 *   `unset` moved it meanwhile, `set` returns `false` and the middleware logs
 *   `middleware.cache.store-skipped`.
 *
 * @example
 * ```typescript
 * const cache = createCacheMiddleware();
 * const db = postgres<Contract>({ contractJson, url, middleware: [cache] });
 *
 * const user = await db.orm.public.User.first(
 *   { id: 1 },
 *   (meta) => meta.annotate(cacheAnnotation({ key: 'user-1' })),
 * );
 * await db.orm.public.User.where({ id: 1 }).update({ name: 'Alicia' });
 * await cache.invalidate({ keys: ['user-1'] });
 * ```
 */
export function createCacheMiddleware<TMeta = unknown>(
  options?: CacheMiddlewareOptions<TMeta>,
): CacheMiddleware<TMeta> {
  const store: CacheStore<unknown, CachedRows> = options?.store ?? createInMemoryCacheStore();
  const deriveKey = options?.deriveKey ?? deriveKeyFromContentHash;
  const pending = new WeakMap<object, PendingMiss>();

  async function interceptQuery(
    exec: ExecutionPlan,
    ctx: RuntimeMiddlewareContext,
  ): Promise<{ readonly rows: Iterable<Record<string, unknown>> } | undefined> {
    if (ctx.scope !== 'runtime') {
      return undefined;
    }
    const annotation = cacheAnnotation.read(exec);
    if (annotation === undefined || annotation.bypass === true) {
      return undefined;
    }

    const key = annotation.key ?? (await deriveKey(exec, ctx));
    const entry = await store.get({ key, meta: annotation.meta });
    if (!entry.data.empty) {
      ctx.log.debug?.({ event: 'middleware.cache.hit', middleware: 'cache', key });
      return { rows: entry.data.value };
    }

    pending.set(exec, { entry, buffer: [] });
    ctx.log.debug?.({ event: 'middleware.cache.miss', middleware: 'cache', key });
    return undefined;
  }

  async function onRow(
    row: Record<string, unknown>,
    exec: ExecutionPlan,
    _ctx: RuntimeMiddlewareContext,
  ): Promise<void> {
    pending.get(exec)?.buffer.push(row);
  }

  async function afterQuery(
    exec: ExecutionPlan,
    result: AfterQueryResult,
    ctx: RuntimeMiddlewareContext,
  ): Promise<void> {
    const miss = pending.get(exec);
    if (miss === undefined) {
      return;
    }
    pending.delete(exec);
    if (!result.completed || result.source !== 'driver') {
      return;
    }
    const stored = await store.set(miss.entry, miss.buffer);
    ctx.log.debug?.({
      event: stored ? 'middleware.cache.store' : 'middleware.cache.store-skipped',
      middleware: 'cache',
      key: miss.entry.key,
    });
  }

  async function invalidate(target: {
    readonly keys?: readonly string[];
    readonly meta?: TMeta;
  }): Promise<void> {
    const keys = target.keys !== undefined && target.keys.length > 0 ? target.keys : undefined;
    if (keys === undefined && target.meta === undefined) {
      return;
    }
    await store.unset({ keys, meta: target.meta });
  }

  return { name: 'cache', interceptQuery, onRow, afterQuery, invalidate };
}

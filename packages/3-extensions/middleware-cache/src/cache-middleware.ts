import type {
  Activity,
  ActivityContext,
  ActivityEndedResult,
  ActivityInterceptResult,
  ClientActivity,
  CrossFamilyMiddleware,
  ExecutionPlan,
} from '@internal/framework-components/runtime';
import { cacheAnnotation } from './cache-annotation';
import {
  type CachedValue,
  type CacheEntry,
  type CacheStore,
  createInMemoryCacheStore,
} from './cache-store';

/**
 * Options accepted by `createCacheMiddleware`.
 *
 * - `store` — the cache backend. Defaults to `createInMemoryCacheStore()`: 1000 values, 60 s.
 * - `deriveKey` — computes the key of a cached statement whose annotation has no `key`. Defaults
 *   to `deriveKeyFromContentHash`. It runs on every such statement, hit or miss, and an error from
 *   it fails the statement. It must return different keys whenever the rows can differ; build on
 *   `deriveKeyFromContentHash` to keep the statement, parameters and storage hash. It does not
 *   apply to a client activity, such as an ORM call, which has no execution plan: a client
 *   activity whose annotation has no `key` is keyed by `activity.contentHash()`. A `deriveKey` that
 *   separates tenants does not separate ORM calls; give each annotated ORM call a tenant-prefixed
 *   `key`, or one tenant's cached ORM read can be served to another.
 *
 * `TMeta` is the store's meta type; `createCacheMiddleware` infers it from `store`. The store holds
 * `CachedValue`.
 */
export interface CacheMiddlewareOptions<TMeta = unknown> {
  readonly store?: CacheStore<TMeta, CachedValue>;
  readonly deriveKey?: (exec: ExecutionPlan, ctx: ActivityContext) => string | Promise<string>;
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
  ctx: ActivityContext,
): Promise<string> {
  return ctx.contentHash(exec);
}

/**
 * A cache miss in flight, kept in the activity's `ctx.state`. `entry` is the entry `store.get`
 * returned; `store.set(entry, value)` is conditional on its version. `buffer` collects a
 * statement's rows; a call has none, since its result arrives when it ends.
 */
interface PendingMiss {
  readonly entry: CacheEntry<unknown, CachedValue>;
  readonly buffer: Record<string, unknown>[] | undefined;
}

const pendingMiss = Symbol('cache.pendingMiss');

function pendingOf(ctx: ActivityContext): PendingMiss | undefined {
  const miss = ctx.state(pendingMiss)['miss'];
  return isPendingMiss(miss) ? miss : undefined;
}

function isPendingMiss(value: unknown): value is PendingMiss {
  return typeof value === 'object' && value !== null && 'entry' in value && 'buffer' in value;
}

function hasTag<K extends CachedValue['kind']>(
  value: CachedValue,
  tag: K,
): value is Extract<CachedValue, { kind: K }> {
  return value.kind === tag;
}

function cacheable(ctx: ActivityContext): boolean {
  return ctx.scope === 'runtime' && !ctx.inTransaction();
}

/** The value a pending miss stores when its activity ends this way, or `undefined` to store nothing. */
function valueToStore(miss: PendingMiss, result: ActivityEndedResult): CachedValue | undefined {
  if (result.outcome !== 'succeeded') return undefined;
  if (result.kind === 'statement') {
    return result.source === 'driver' && miss.buffer !== undefined
      ? { kind: 'statement-rows', rows: miss.buffer }
      : undefined;
  }
  if (result.kind === 'transaction') return undefined;
  return result.source === 'client' && result.result !== undefined
    ? { kind: 'call-result', result: result.result }
    : undefined;
}

/**
 * Creates a read-through cache middleware that works with every family runtime.
 *
 * It caches an activity that carries `cacheAnnotation` without `bypass` and runs in runtime scope,
 * outside any transaction: never on a held connection, whose session may change what a read
 * returns, and never inside a transaction, which must read its own uncommitted writes. Two kinds
 * of activity are cached:
 *
 * - A statement whose plan carries the annotation, such as an annotated SQL builder query. Its key
 *   is the annotation's `key`, else `deriveKey(exec, ctx)`; its value is the raw rows.
 * - A client activity that carries the annotation, such as an annotated ORM read. Its key is the
 *   annotation's `key`, else `await activity.contentHash()`; its value is the result the client
 *   ended the activity with. It is served as a whole, so a hit sends no statement.
 *
 * The middleware tags each stored value `statement-rows` or `call-result` and serves `statement-rows` only to a statement and `call-result` only to a client activity; under the same key, a value with the other tag is a miss, and the read stores its own value in its place. A key therefore belongs to one query and one terminal method: an ORM call served another method's result under a shared key fails with `ORM.INTERCEPTED_RESULT_INVALID` or returns the wrong shape.
 *
 * - `intercept.onQuery` and `intercept.onActivity` — on a hit, return the stored rows or result,
 *   and nothing runs. On a miss, record the pending entry.
 * - `onRow` — collects each row of a statement miss.
 * - `activityEnded` — when the driver completed the statement, or the client ended the call
 *   `succeeded` with a result (`null` is a result), calls `store.set(entry, value)` with the entry
 *   `store.get` returned, which stores only if the key's version has not moved. If an `unset` moved
 *   it meanwhile, `set` returns `false` and the middleware logs `middleware.cache.store-skipped`.
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
  const store: CacheStore<unknown, CachedValue> = options?.store ?? createInMemoryCacheStore();
  const deriveKey = options?.deriveKey ?? deriveKeyFromContentHash;

  async function lookUp<K extends CachedValue['kind']>(
    tag: K,
    key: string,
    meta: unknown,
    ctx: ActivityContext,
    buffer: Record<string, unknown>[] | undefined,
  ): Promise<Extract<CachedValue, { kind: K }> | undefined> {
    const entry = await store.get({ key, meta });
    if (!entry.data.empty && hasTag(entry.data.value, tag)) {
      ctx.log.debug?.({ event: 'middleware.cache.hit', middleware: 'cache', key });
      return entry.data.value;
    }
    ctx.state(pendingMiss)['miss'] = { entry, buffer };
    ctx.log.debug?.({ event: 'middleware.cache.miss', middleware: 'cache', key });
    return undefined;
  }

  async function onQuery(
    exec: ExecutionPlan,
    ctx: ActivityContext,
  ): Promise<{ readonly rows: Iterable<Record<string, unknown>> } | undefined> {
    if (!cacheable(ctx)) {
      return undefined;
    }
    const annotation = cacheAnnotation.read(exec);
    if (annotation === undefined || annotation.bypass === true) {
      return undefined;
    }
    const key = annotation.key ?? (await deriveKey(exec, ctx));
    const value = await lookUp('statement-rows', key, annotation.meta, ctx, []);
    return value === undefined ? undefined : { rows: value.rows };
  }

  async function onActivity(
    activity: ClientActivity,
    ctx: ActivityContext,
  ): Promise<ActivityInterceptResult | undefined> {
    if (!cacheable(ctx)) {
      return undefined;
    }
    const annotation = cacheAnnotation.read(activity);
    if (annotation === undefined || annotation.bypass === true) {
      return undefined;
    }
    const key = annotation.key ?? (await activity.contentHash());
    const value = await lookUp('call-result', key, annotation.meta, ctx, undefined);
    return value === undefined ? undefined : { result: value.result };
  }

  async function onRow(
    row: Record<string, unknown>,
    _exec: ExecutionPlan,
    ctx: ActivityContext,
  ): Promise<void> {
    pendingOf(ctx)?.buffer?.push(row);
  }

  async function activityEnded(
    _activity: Activity,
    result: ActivityEndedResult,
    ctx: ActivityContext,
  ): Promise<void> {
    const miss = pendingOf(ctx);
    if (miss === undefined) {
      return;
    }
    delete ctx.state(pendingMiss)['miss'];
    const value = valueToStore(miss, result);
    if (value === undefined) {
      return;
    }
    const stored = await store.set(miss.entry, value);
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

  return { name: 'cache', intercept: { onQuery, onActivity }, onRow, activityEnded, invalidate };
}

import type { PlanMeta } from '@internal/contract/types';
import type {
  AfterQueryResult,
  ExecutionPlan,
  RuntimeMiddlewareContext,
} from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware, uncache as runUncache } from '../src/cache-middleware';
import { type CachedEntry, type CacheStore, createInMemoryCacheStore } from '../src/cache-store';
import { type UncacheAction, uncacheAnnotation } from '../src/uncache-annotation';

interface MockExec extends ExecutionPlan {
  readonly statement: string;
}

const baseMeta: PlanMeta = {
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'test',
  lane: 'orm',
};

function makeExec(statement: string, annotations?: Record<string, unknown>): MockExec {
  return Object.freeze({
    statement,
    meta: annotations ? { ...baseMeta, annotations } : baseMeta,
  });
}

function makeCtx(overrides?: Partial<RuntimeMiddlewareContext>): RuntimeMiddlewareContext {
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    contentHash: async (exec) => `key:${(exec as MockExec).statement}`,
    scope: 'runtime',
    planExecutionId: 'test-fixture-plan-execution-id',
    ...overrides,
  };
}

function makeContractWithCompositePrimaryKey() {
  return {
    storage: {
      namespaces: {
        public: {
          tables: {
            kv: {
              primaryKey: { columns: ['ns', 'key'] },
            },
          },
        },
      },
    },
    domain: {
      namespaces: {
        public: {
          models: {
            Kv: {
              storage: { table: 'kv' },
            },
          },
        },
      },
    },
  };
}

function spyStore(): CacheStore & {
  readonly getSpy: ReturnType<typeof vi.fn>;
  readonly setSpy: ReturnType<typeof vi.fn>;
  readonly listSpy: ReturnType<typeof vi.fn>;
  readonly delSpy: ReturnType<typeof vi.fn>;
  readonly inner: Map<string, CachedEntry>;
} {
  const inner = new Map<string, CachedEntry>();
  const getSpy = vi.fn(async (key: string) => inner.get(key));
  const setSpy = vi.fn(async (key: string, entry: CachedEntry, _ttlMs: number) => {
    inner.set(key, entry);
  });
  const listSpy = vi.fn(async (prefix?: string) => {
    const keys = [...inner.keys()];
    return prefix === undefined ? keys : keys.filter((key) => key.startsWith(prefix));
  });
  const delSpy = vi.fn(async (key: string) => {
    inner.delete(key);
  });
  return {
    get: getSpy,
    set: setSpy,
    list: listSpy,
    del: delSpy,
    getSpy,
    setSpy,
    listSpy,
    delSpy,
    inner,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('createCacheMiddleware — opt-in semantics', () => {
  it('passes through (no store interaction) when the plan has no cache annotation', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1'); // no annotations

    const result = await mw.interceptQuery!(exec, makeCtx());
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('passes through when the cache annotation has skip: true', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000, skip: true }),
    });

    const result = await mw.interceptQuery!(exec, makeCtx());
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('passes through when no ttl is supplied (presence alone is not sufficient)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });

    const result = await mw.interceptQuery!(exec, makeCtx());
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('does not store rows for an un-annotated plan even when onRow/afterQuery fire (driver path)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1');
    const ctx = makeCtx();

    await mw.interceptQuery!(exec, ctx); // passthrough
    await mw.onRow!({ id: 1 }, exec, ctx);
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).not.toHaveBeenCalled();
  });
});

describe('createCacheMiddleware — hit path', () => {
  it('returns cached rows from interceptQuery when the store has a non-expired entry', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', {
      rows: [{ id: 1 }, { id: 2 }],
      storedAt: 0,
    });

    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });

    const result = await mw.interceptQuery!(exec, makeCtx());
    expect(result).toBeDefined();
    expect(await drain(result!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it('logs a middleware.cache.hit event via ctx.log.debug on a hit', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', { rows: [{ id: 1 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const debug = vi.fn();
    const ctx = makeCtx({
      log: { info: () => {}, warn: () => {}, error: () => {}, debug },
    });

    await mw.interceptQuery!(exec, ctx);

    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ event: 'middleware.cache.hit' }));
  });

  it('does not call store.set on the hit path', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', { rows: [{ id: 1 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    const result = await mw.interceptQuery!(exec, ctx);
    await drain(result!.rows as AsyncIterable<Record<string, unknown>>);

    // afterQuery fires with source: 'middleware' on a hit; the cache
    // middleware should not write back to the store.
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 0, completed: true, source: 'middleware' },
      ctx,
    );

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('survives the absence of ctx.log.debug (it is optional on RuntimeLog)', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', { rows: [{ id: 1 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx({
      // No debug field.
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await expect(mw.interceptQuery!(exec, ctx)).resolves.toBeDefined();
  });
});

describe('createCacheMiddleware — miss path', () => {
  it('returns undefined from interceptQuery on a miss', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });

    const result = await mw.interceptQuery!(exec, makeCtx());
    expect(result).toBeUndefined();
  });

  it('logs a middleware.cache.miss event via ctx.log.debug on a miss', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const debug = vi.fn();
    const ctx = makeCtx({
      log: { info: () => {}, warn: () => {}, error: () => {}, debug },
    });

    await mw.interceptQuery!(exec, ctx);

    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ event: 'middleware.cache.miss' }));
  });

  it('buffers rows via onRow and commits on a successful afterQuery (source: driver)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, clock: () => 1_234 });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await mw.interceptQuery!(exec, ctx); // miss
    await mw.onRow!({ id: 1 }, exec, ctx);
    await mw.onRow!({ id: 2 }, exec, ctx);
    await mw.afterQuery!(
      exec,
      { rowCount: 2, latencyMs: 5, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).toHaveBeenCalledTimes(1);
    expect(store.setSpy).toHaveBeenCalledWith(
      'key:select 1',
      expect.objectContaining({
        rows: [{ id: 1 }, { id: 2 }],
        storedAt: 1_234,
      }),
      60_000,
    );
  });

  it('does not commit when completed = false (driver threw mid-stream)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await mw.interceptQuery!(exec, ctx);
    await mw.onRow!({ id: 1 }, exec, ctx);
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 5, completed: false, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('does not commit when source = "middleware" (a different interceptQueryor produced the rows)', async () => {
    // If another middleware wins the interceptQuery chain, our interceptQuery did
    // not fire — we never called set up a buffer. afterQuery would see
    // source === 'middleware' and we should not store anything.
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    // Note: skipping interceptQuery and onRow simulates the case where a
    // different interceptQueryor short-circuited execution upstream.
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 5, completed: true, source: 'middleware' },
      ctx,
    );

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('cleans up its WeakMap entry on afterQuery even when no commit happens', async () => {
    // The buffer is a WeakMap keyed on the exec object — testing this
    // directly would be brittle; instead, verify behavior: re-running
    // afterQuery without an interceptQuery call should be a no-op even if
    // the previous run did not commit.
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await mw.interceptQuery!(exec, ctx);
    await mw.onRow!({ id: 1 }, exec, ctx);
    // Mid-stream failure.
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 5, completed: false, source: 'driver' },
      ctx,
    );

    // A second afterQuery (defensive — should never happen in
    // practice, but verify cleanup didn't leave residue).
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 5, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('keeps per-execution buffers isolated across two concurrent execs', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, clock: () => 0 });
    const execA = makeExec('select A', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const execB = makeExec('select B', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    // Interleave the two executions to stress per-exec buffer isolation.
    await mw.interceptQuery!(execA, ctx);
    await mw.interceptQuery!(execB, ctx);
    await mw.onRow!({ from: 'A', n: 1 }, execA, ctx);
    await mw.onRow!({ from: 'B', n: 1 }, execB, ctx);
    await mw.onRow!({ from: 'A', n: 2 }, execA, ctx);
    await mw.onRow!({ from: 'B', n: 2 }, execB, ctx);

    const result: AfterQueryResult = {
      rowCount: 2,
      latencyMs: 0,
      completed: true,
      source: 'driver',
    };
    await mw.afterQuery!(execA, result, ctx);
    await mw.afterQuery!(execB, result, ctx);

    expect(store.inner.get('key:select A')?.rows).toEqual([
      { from: 'A', n: 1 },
      { from: 'A', n: 2 },
    ]);
    expect(store.inner.get('key:select B')?.rows).toEqual([
      { from: 'B', n: 1 },
      { from: 'B', n: 2 },
    ]);
  });

  it('deduplicates concurrent misses for the same key (single-flight)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, readDedupe: true, clock: () => 0 });
    const leaderExec = makeExec('select dedupe', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const followerExec = makeExec('select dedupe', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await mw.intercept!(leaderExec, ctx);
    const follower = mw.intercept!(followerExec, ctx);

    let settled = false;
    void follower.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await mw.onRow!({ id: 1 }, leaderExec, ctx);
    await mw.afterExecute!(
      leaderExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await expect(follower).resolves.toEqual({ rows: [{ id: 1 }] });
    expect(store.setSpy).toHaveBeenCalledTimes(1);
  });

  it('detached storeOperationMode does not await slow store.set on read commit', async () => {
    const gate = deferred<void>();
    const inner = new Map<string, CachedEntry>();
    const getSpy = vi.fn(async (key: string) => inner.get(key));
    const setSpy = vi.fn(async (key: string, entry: CachedEntry) => {
      await gate.promise;
      inner.set(key, entry);
    });
    const store: CacheStore = {
      get: getSpy,
      set: setSpy,
      list: async () => [],
      del: async () => {},
    };

    const mw = createCacheMiddleware({ store, storeOperationMode: 'detached', clock: () => 0 });
    const exec = makeExec('select detached set', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await mw.intercept!(exec, ctx);
    await mw.onRow!({ id: 1 }, exec, ctx);

    const after = mw.afterExecute!(
      exec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    const completionRace = await Promise.race([
      after.then(() => 'after' as const),
      new Promise<'tick'>((resolve) => setTimeout(() => resolve('tick'), 0)),
    ]);
    expect(completionRace).toBe('after');
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(inner.get('key:select detached set')).toBeUndefined();

    gate.resolve();
    await after;
    await Promise.resolve();
    expect(inner.get('key:select detached set')?.rows).toEqual([{ id: 1 }]);
  });

  it('falls back to passthrough for deduplicated followers when the leader fails', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, readDedupe: true });
    const leaderExec = makeExec('select dedupe fail', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const followerExec = makeExec('select dedupe fail', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await mw.intercept!(leaderExec, ctx);
    const follower = mw.intercept!(followerExec, ctx);

    await mw.afterExecute!(
      leaderExec,
      { rowCount: 0, latencyMs: 1, completed: false, source: 'driver' },
      ctx,
    );

    await expect(follower).resolves.toBeUndefined();
    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('global readDedupe: false disables single-flight dedupe', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, readDedupe: false, clock: () => 0 });
    const leaderExec = makeExec('select dedupe global off', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const followerExec = makeExec('select dedupe global off', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await expect(mw.intercept!(leaderExec, ctx)).resolves.toBeUndefined();
    await expect(mw.intercept!(followerExec, ctx)).resolves.toBeUndefined();

    await mw.onRow!({ leader: true }, leaderExec, ctx);
    await mw.onRow!({ follower: true }, followerExec, ctx);
    await mw.afterExecute!(
      leaderExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );
    await mw.afterExecute!(
      followerExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).toHaveBeenCalledTimes(2);
  });

  it('readDedupe defaults to false', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, clock: () => 0 });
    const leaderExec = makeExec('select dedupe default off', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const followerExec = makeExec('select dedupe default off', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await expect(mw.intercept!(leaderExec, ctx)).resolves.toBeUndefined();
    await expect(mw.intercept!(followerExec, ctx)).resolves.toBeUndefined();

    await mw.onRow!({ leader: true }, leaderExec, ctx);
    await mw.onRow!({ follower: true }, followerExec, ctx);
    await mw.afterExecute!(
      leaderExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );
    await mw.afterExecute!(
      followerExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).toHaveBeenCalledTimes(2);
  });

  it('cacheAnnotation dedupe: true overrides global readDedupe: false', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, readDedupe: false, clock: () => 0 });
    const leaderExec = makeExec('select dedupe annotation on', {
      cache: cacheAnnotation({ ttl: 60_000, dedupe: true }),
    });
    const followerExec = makeExec('select dedupe annotation on', {
      cache: cacheAnnotation({ ttl: 60_000, dedupe: true }),
    });
    const ctx = makeCtx();

    await mw.intercept!(leaderExec, ctx);
    const follower = mw.intercept!(followerExec, ctx);

    await mw.onRow!({ id: 1 }, leaderExec, ctx);
    await mw.afterExecute!(
      leaderExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await expect(follower).resolves.toEqual({ rows: [{ id: 1 }] });
    expect(store.setSpy).toHaveBeenCalledTimes(1);
  });

  it('cacheAnnotation dedupe: false overrides global readDedupe: true', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, readDedupe: true, clock: () => 0 });
    const leaderExec = makeExec('select dedupe annotation off', {
      cache: cacheAnnotation({ ttl: 60_000, dedupe: false }),
    });
    const followerExec = makeExec('select dedupe annotation off', {
      cache: cacheAnnotation({ ttl: 60_000, dedupe: false }),
    });
    const ctx = makeCtx();

    await expect(mw.intercept!(leaderExec, ctx)).resolves.toBeUndefined();
    await expect(mw.intercept!(followerExec, ctx)).resolves.toBeUndefined();

    await mw.onRow!({ leader: true }, leaderExec, ctx);
    await mw.onRow!({ follower: true }, followerExec, ctx);
    await mw.afterExecute!(
      leaderExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );
    await mw.afterExecute!(
      followerExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).toHaveBeenCalledTimes(2);
  });
});

describe('createCacheMiddleware — scope guard', () => {
  it('passes through when ctx.scope = "connection"', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', { rows: [{ id: 1 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });

    const result = await mw.interceptQuery!(exec, makeCtx({ scope: 'connection' }));
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
  });

  it('passes through when ctx.scope = "transaction"', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', { rows: [{ id: 1 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });

    const result = await mw.interceptQuery!(exec, makeCtx({ scope: 'transaction' }));
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
  });

  it('does not store rows on connection-scope writes either', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx({ scope: 'connection' });

    await mw.interceptQuery!(exec, ctx);
    await mw.onRow!({ id: 1 }, exec, ctx);
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.setSpy).not.toHaveBeenCalled();
  });
});

describe('createCacheMiddleware — middleware shape', () => {
  it('is a cross-family middleware (no familyId)', () => {
    const mw = createCacheMiddleware({ store: spyStore() });
    expect(mw.familyId).toBeUndefined();
    expect(mw.targetId).toBeUndefined();
  });

  it('exposes a stable name', () => {
    const mw = createCacheMiddleware({ store: spyStore() });
    expect(mw.name).toBe('cache');
  });

  it('wires interceptQuery, onRow, and afterQuery (only)', () => {
    const mw = createCacheMiddleware({ store: spyStore() });
    expect(mw.interceptQuery).toBeDefined();
    expect(mw.onRow).toBeDefined();
    expect(mw.afterQuery).toBeDefined();
    // No beforeQuery — the cache middleware doesn't observe the pre-
    // execute event.
    expect(mw.beforeQuery).toBeUndefined();
  });

  it('defaults to an in-memory LRU store when none is supplied', () => {
    // Smoke: the constructor accepts no store and produces a working
    // middleware. Behavior is exercised by the roundtrip test below.
    const mw = createCacheMiddleware();
    expect(mw.interceptQuery).toBeDefined();
  });

  it('roundtrips a miss-then-hit through the default in-memory store', async () => {
    const mw = createCacheMiddleware({ maxEntries: 10 });
    const exec = makeExec('select roundtrip', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    // Miss.
    expect(await mw.interceptQuery!(exec, ctx)).toBeUndefined();
    await mw.onRow!({ id: 1 }, exec, ctx);
    await mw.onRow!({ id: 2 }, exec, ctx);
    await mw.afterQuery!(
      exec,
      { rowCount: 2, latencyMs: 0, completed: true, source: 'driver' },
      ctx,
    );

    // Hit on the next call.
    const second = await mw.interceptQuery!(exec, ctx);
    expect(second).toBeDefined();
    expect(await drain(second!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it('respects a user-supplied custom CacheStore', async () => {
    const store = createInMemoryCacheStore({ maxEntries: 5 });
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select custom', {
      cache: cacheAnnotation({ ttl: 60_000 }),
    });
    const ctx = makeCtx();

    await mw.interceptQuery!(exec, ctx);
    await mw.onRow!({ id: 7 }, exec, ctx);
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
      ctx,
    );

    const stored = await store.get('key:custom-not-this');
    expect(stored).toBeUndefined();
    const real = await store.get('key:select custom');
    expect(real?.rows).toEqual([{ id: 7 }]);
  });
});

describe('createCacheMiddleware — standalone uncache()', () => {
  it('exposes an uncache method', () => {
    const mw = createCacheMiddleware({ store: spyStore() });
    expect(typeof mw.uncache).toBe('function');
  });

  it('deletes explicit keys from the store', async () => {
    const store = spyStore();
    store.inner.set('user:1', { rows: [{ id: 1 }], storedAt: 0 });
    store.inner.set('user:2', { rows: [{ id: 2 }], storedAt: 0 });
    store.inner.set('post:1', { rows: [{ id: 3 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });

    const uncacheActions: readonly UncacheAction[] = [{ keys: ['user:1', 'user:2'] }];
    await mw.uncache(uncacheActions);

    expect(await store.get('user:1')).toBeUndefined();
    expect(await store.get('user:2')).toBeUndefined();
    expect(await store.get('post:1')).toBeDefined();
  });

  it('deletes keys with namespace prefix when namespace is set on the action', async () => {
    const store = spyStore();
    store.inner.set('ns:user:1', { rows: [{ id: 1 }], storedAt: 0 });
    store.inner.set('ns:user:2', { rows: [{ id: 2 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });

    await mw.uncache([{ namespace: 'ns', keys: ['user:1', 'user:2'] }]);

    expect(await store.get('ns:user:1')).toBeUndefined();
    expect(await store.get('ns:user:2')).toBeUndefined();
  });

  it('deletes all keys with matching namespace prefix when keys is omitted', async () => {
    const store = spyStore();
    store.inner.set('users:1', { rows: [{ id: 1 }], storedAt: 0 });
    store.inner.set('users:2', { rows: [{ id: 2 }], storedAt: 0 });
    store.inner.set('posts:1', { rows: [{ id: 3 }], storedAt: 0 });
    const mw = createCacheMiddleware({ store });

    await mw.uncache([{ namespace: 'users' }]);

    expect(await store.get('users:1')).toBeUndefined();
    expect(await store.get('users:2')).toBeUndefined();
    expect(await store.get('posts:1')).toBeDefined();
  });

  it('executes multiple actions in order', async () => {
    const store = spyStore();
    store.inner.set('a:1', { rows: [], storedAt: 0 });
    store.inner.set('b:1', { rows: [], storedAt: 0 });
    const mw = createCacheMiddleware({ store });

    await mw.uncache([{ namespace: 'a' }, { namespace: 'b' }]);

    expect(await store.get('a:1')).toBeUndefined();
    expect(await store.get('b:1')).toBeUndefined();
  });

  it('supports model-based invalidation via middleware.uncache()', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: false,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readUsersExec = Object.freeze({
      ...makeExec('select users manual-model'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const readPostsExec = Object.freeze({
      ...makeExec('select posts manual-model'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'posts' } },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readUsersExec, readPostsExec]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    await mw.uncache([{ models: ['users'] }]);

    expect(await mw.intercept!(readUsersExec, ctx)).toBeUndefined();
    expect(await mw.intercept!(readPostsExec, ctx)).toBeDefined();
  });

  it('exports uncache helper function and delegates to middleware.uncache()', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    store.inner.set('export:user:1', { rows: [{ id: 1 }], storedAt: 0 });

    await runUncache(mw, [{ keys: ['export:user:1'] }]);

    expect(await store.get('export:user:1')).toBeUndefined();
  });

  it('throws when the store does not implement del and explicit keys are provided', async () => {
    const minimalStore: CacheStore = {
      async get(_key) {
        return undefined;
      },
      async set(_key, _entry, _ttlMs) {},
    };
    const mw = createCacheMiddleware({ store: minimalStore });

    await expect(mw.uncache([{ keys: ['user:1'] }])).rejects.toThrow(/does not implement `del`/);
  });
});

describe('createCacheMiddleware — global policy controls', () => {
  it('detached storeOperationMode does not await slow store.del on mutation invalidation', async () => {
    const gate = deferred<void>();
    const inner = new Map<string, CachedEntry>();
    inner.set('k:1', { rows: [{ id: 1 }], storedAt: 0 });

    const getSpy = vi.fn(async (key: string) => inner.get(key));
    const setSpy = vi.fn(async (key: string, entry: CachedEntry) => {
      inner.set(key, entry);
    });
    const delSpy = vi.fn(async (key: string) => {
      await gate.promise;
      inner.delete(key);
    });
    const store: CacheStore = {
      get: getSpy,
      set: setSpy,
      list: async () => [],
      del: delSpy,
    };

    const mw = createCacheMiddleware({
      store,
      storeOperationMode: 'detached',
      uncacheOnMutation: true,
    });
    const write = Object.freeze({
      ...makeExec('mutation detached del', {
        uncache: uncacheAnnotation({ uncache: [{ keys: ['k:1'] }] }),
      }),
      ast: {
        kind: 'update',
        table: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const ctx = makeCtx();

    const after = mw.afterExecute!(
      write,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    const completionRace = await Promise.race([
      after.then(() => 'after' as const),
      new Promise<'tick'>((resolve) => setTimeout(() => resolve('tick'), 0)),
    ]);
    expect(completionRace).toBe('after');
    expect(delSpy).toHaveBeenCalledWith('k:1');
    expect(inner.has('k:1')).toBe(true);

    gate.resolve();
    await after;
    await Promise.resolve();
    expect(inner.has('k:1')).toBe(false);
  });

  it('falls back to generation invalidation when uncache is triggered but store lacks del/list', async () => {
    const minimalStore: CacheStore = {
      async get(_key) {
        return undefined;
      },
      async set(_key, _entry, _ttlMs) {},
      // no list, no del
    };
    const mw = createCacheMiddleware({
      store: minimalStore,
      uncacheOnMutation: true,
    });
    const writeExec = Object.freeze({
      ...makeExec('delete users'),
      ast: {
        kind: 'delete',
        table: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const ctx = makeCtx();

    await expect(
      mw.afterExecute!(
        writeExec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      ),
    ).resolves.toBeUndefined();
  });

  it('automatically uses generation versioning without del/list for model invalidation', async () => {
    const inner = new Map<string, CachedEntry>();
    const store: CacheStore = {
      async get(key) {
        return inner.get(key);
      },
      async set(key, entry) {
        inner.set(key, entry);
      },
    };
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
      cacheStrategy: { mode: 'broad' },
    });
    const readExec = Object.freeze({
      ...makeExec('select users fallback generation'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users fallback generation'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeDefined();

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeUndefined();
  });
  it('caches unannotated reads when global readCaching is enabled and defaultTtlMs is set', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const exec: MockExec = makeExec('select global-read');
    const execWithAst: MockExec = Object.freeze({
      ...exec,
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const ctx = makeCtx();

    const first = await mw.intercept!(execWithAst, ctx);
    expect(first).toBeUndefined();
    await mw.onRow!({ id: 1 }, execWithAst, ctx);
    await mw.afterExecute!(
      execWithAst,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    const second = await mw.intercept!(execWithAst, ctx);
    expect(second).toBeDefined();
    expect(await drain(second!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
      { id: 1 },
    ]);
  });

  it('invalidates cached read keys on write when uncacheOnMutation is globally enabled', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users'),
      ast: {
        kind: 'update',
        table: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeDefined();

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    const postMutation = await mw.intercept!(readExec, ctx);
    expect(postMutation).toBeUndefined();
  });

  it('allows uncacheAnnotation to force invalidation even when global uncache is disabled', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: false,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users force'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users force', {
        uncache: uncacheAnnotation({ enabled: true }),
      }),
      ast: {
        kind: 'update',
        table: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeUndefined();
  });

  it('allows uncacheAnnotation skip to suppress global invalidation', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users skip'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users skip', {
        uncache: uncacheAnnotation({ skip: true }),
      }),
      ast: {
        kind: 'update',
        table: { kind: 'table-source', name: 'users' },
      },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeDefined();
  });

  it('enabled: false on uncacheAnnotation suppresses global invalidation', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users enabled-false'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users enabled-false', {
        uncache: uncacheAnnotation({ enabled: false }),
      }),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeDefined();
  });

  it('failed mutation (completed: false) does not invalidate cache', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users failed-mut'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('delete users failed'),
      ast: { kind: 'delete', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      writeExec,
      { rowCount: 0, latencyMs: 1, completed: false, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeDefined();
  });
});

describe('createCacheMiddleware — model-indexed invalidation', () => {
  it('invalidates cache when model is discovered through a nested derived-table source', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const nestedRead = Object.freeze({
      ...makeExec('select derived users'),
      ast: {
        kind: 'select',
        from: {
          kind: 'derived-table-source',
          query: {
            kind: 'select',
            from: { kind: 'table-source', name: 'users' },
          },
        },
      },
    }) as MockExec;
    const mutateUsersExec = Object.freeze({
      ...makeExec('update users nested'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(nestedRead, ctx);
    await mw.onRow!({ id: 1 }, nestedRead, ctx);
    await mw.afterExecute!(
      nestedRead,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(nestedRead, ctx)).toBeDefined();

    await mw.afterExecute!(
      mutateUsersExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(nestedRead, ctx)).toBeUndefined();
  });

  it('invalidates a JOIN-read when a mutation touches any of the joined tables', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const joinRead = Object.freeze({
      ...makeExec('select users join posts'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        joins: [{ source: { kind: 'table-source', name: 'posts' } }],
      },
    }) as MockExec;
    const mutatePostsExec = Object.freeze({
      ...makeExec('update posts'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'posts' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(joinRead, ctx);
    await mw.onRow!({ id: 1 }, joinRead, ctx);
    await mw.afterExecute!(
      joinRead,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(joinRead, ctx)).toBeDefined();

    await mw.afterExecute!(
      mutatePostsExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(joinRead, ctx)).toBeUndefined();
  });

  it('invalidates a JOIN-read when a mutation touches the primary (FROM) table', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const joinRead = Object.freeze({
      ...makeExec('select users join posts 2'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        joins: [{ source: { kind: 'table-source', name: 'posts' } }],
      },
    }) as MockExec;
    const mutateUsersExec = Object.freeze({
      ...makeExec('delete users'),
      ast: { kind: 'delete', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(joinRead, ctx);
    await mw.onRow!({ id: 1 }, joinRead, ctx);
    await mw.afterExecute!(
      joinRead,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      mutateUsersExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(joinRead, ctx)).toBeUndefined();
  });

  it('invalidates only the matching entity cache for simple id-based CRUD', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readUser1Exec = Object.freeze({
      ...makeExec('select users where id = 1'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
      },
    }) as MockExec;
    const readUser2Exec = Object.freeze({
      ...makeExec('select users where id = 2'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 2 },
        },
      },
    }) as MockExec;
    const deleteUser1Exec = Object.freeze({
      ...makeExec('delete users where id = 1'),
      ast: {
        kind: 'delete',
        table: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
      },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readUser1Exec, ctx);
    await mw.onRow!({ id: 1 }, readUser1Exec, ctx);
    await mw.afterExecute!(
      readUser1Exec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.intercept!(readUser2Exec, ctx);
    await mw.onRow!({ id: 2 }, readUser2Exec, ctx);
    await mw.afterExecute!(
      readUser2Exec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUser1Exec, ctx)).toBeDefined();
    expect(await mw.intercept!(readUser2Exec, ctx)).toBeDefined();

    await mw.afterExecute!(
      deleteUser1Exec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUser1Exec, ctx)).toBeUndefined();
    expect(await mw.intercept!(readUser2Exec, ctx)).toBeDefined();
  });

  it('uses broad model invalidation when cacheStrategy.mode = model', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: { mode: 'broad' },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readUser1Exec = Object.freeze({
      ...makeExec('select users model-strategy id=1'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
      },
    }) as MockExec;
    const readUser2Exec = Object.freeze({
      ...makeExec('select users model-strategy id=2'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 2 },
        },
      },
    }) as MockExec;
    const deleteUser1Exec = Object.freeze({
      ...makeExec('delete users model-strategy id=1'),
      ast: {
        kind: 'delete',
        table: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
      },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readUser1Exec, readUser2Exec]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    await mw.afterExecute!(
      deleteUser1Exec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUser1Exec, ctx)).toBeUndefined();
    expect(await mw.intercept!(readUser2Exec, ctx)).toBeUndefined();
  });

  it('invalidates an exact composite-primary-key entity cache when the contract exposes the primary key', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const ctx = makeCtx({ contract: makeContractWithCompositePrimaryKey() });
    const readKvExec = Object.freeze({
      ...makeExec('select kv exact pk'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'kv' },
        where: {
          kind: 'and',
          exprs: [
            {
              kind: 'binary',
              op: 'eq',
              left: { kind: 'column-ref', table: 'kv', column: 'ns' },
              right: { kind: 'literal', value: 'tenant-a' },
            },
            {
              kind: 'binary',
              op: 'eq',
              left: { kind: 'column-ref', table: 'kv', column: 'key' },
              right: { kind: 'literal', value: 'feature-x' },
            },
          ],
        },
      },
    }) as MockExec;
    const deleteKvExec = Object.freeze({
      ...makeExec('delete kv exact pk'),
      ast: {
        kind: 'delete',
        table: { kind: 'table-source', name: 'kv' },
        where: {
          kind: 'and',
          exprs: [
            {
              kind: 'binary',
              op: 'eq',
              left: { kind: 'column-ref', table: 'kv', column: 'ns' },
              right: { kind: 'literal', value: 'tenant-a' },
            },
            {
              kind: 'binary',
              op: 'eq',
              left: { kind: 'column-ref', table: 'kv', column: 'key' },
              right: { kind: 'literal', value: 'feature-x' },
            },
          ],
        },
      },
    }) as MockExec;

    await mw.intercept!(readKvExec, ctx);
    await mw.onRow!({ ns: 'tenant-a', key: 'feature-x', enabled: true }, readKvExec, ctx);
    await mw.afterExecute!(
      readKvExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readKvExec, ctx)).toBeDefined();

    await mw.afterExecute!(
      deleteKvExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readKvExec, ctx)).toBeUndefined();
  });
  it('model strategy invalidation crosses middleware instances that share the same store', async () => {
    const store = createInMemoryCacheStore({ maxEntries: 20 });
    const mwA = createCacheMiddleware({
      store,
      cacheStrategy: { mode: 'broad' },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const mwB = createCacheMiddleware({
      store,
      cacheStrategy: { mode: 'broad' },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users shared-model overlap'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('delete users shared-model overlap'),
      ast: { kind: 'delete', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mwA.intercept!(readExec, ctx);
    await mwA.onRow!({ id: 1 }, readExec, ctx);
    await mwA.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mwA.intercept!(readExec, ctx)).toBeDefined();

    await mwB.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mwA.intercept!(readExec, ctx)).toBeUndefined();
  });

  it('uses generation invalidation when cacheStrategy.mode = generation', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: { mode: 'versioned' },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readUser1Exec = Object.freeze({
      ...makeExec('select users generation id=1'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
      },
    }) as MockExec;
    const readUser2Exec = Object.freeze({
      ...makeExec('select users generation id=2'),
      ast: {
        kind: 'select',
        from: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 2 },
        },
      },
    }) as MockExec;
    const deleteUser1Exec = Object.freeze({
      ...makeExec('delete users generation id=1'),
      ast: {
        kind: 'delete',
        table: { kind: 'table-source', name: 'users' },
        where: {
          kind: 'binary',
          op: 'eq',
          left: { kind: 'column-ref', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
      },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readUser1Exec, readUser2Exec]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    expect(await mw.intercept!(readUser1Exec, ctx)).toBeDefined();
    expect(await mw.intercept!(readUser2Exec, ctx)).toBeDefined();

    await mw.afterExecute!(
      deleteUser1Exec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUser1Exec, ctx)).toBeUndefined();
    expect(await mw.intercept!(readUser2Exec, ctx)).toBeUndefined();
  });

  it('generation strategy invalidation crosses middleware instances that share the same store', async () => {
    const store = createInMemoryCacheStore({ maxEntries: 20 });
    const mwA = createCacheMiddleware({
      store,
      cacheStrategy: { mode: 'versioned' },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const mwB = createCacheMiddleware({
      store,
      cacheStrategy: { mode: 'versioned' },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users shared-generation overlap'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('delete users shared-generation overlap'),
      ast: { kind: 'delete', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mwA.intercept!(readExec, ctx);
    await mwA.onRow!({ id: 1 }, readExec, ctx);
    await mwA.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mwA.intercept!(readExec, ctx)).toBeDefined();

    await mwB.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mwA.intercept!(readExec, ctx)).toBeUndefined();
  });

  it('generation mode does not require del/list for model invalidation', async () => {
    const minimalStore: CacheStore = {
      async get(_key) {
        return undefined;
      },
      async set(_key, _entry, _ttlMs) {},
    };
    const mw = createCacheMiddleware({
      store: minimalStore,
      cacheStrategy: { mode: 'versioned' },
      uncacheOnMutation: true,
    });
    const writeExec = Object.freeze({
      ...makeExec('update users generation no-del-list'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;

    await expect(
      mw.afterExecute!(
        writeExec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        makeCtx(),
      ),
    ).resolves.toBeUndefined();
  });

  it('generation bumpOn=all-writes invalidates on writes even when uncache is disabled', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: { mode: 'versioned', generation: { bumpOn: 'all-writes' } },
      uncacheOnMutation: false,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users generation all-writes read'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users generation all-writes write'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeDefined();

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeUndefined();
  });

  it('generation scope action-models-preferred bumps annotation models for all-writes', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: {
        mode: 'versioned',
        generation: { bumpOn: 'all-writes', scope: 'action-models-preferred' },
      },
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readUsersExec = Object.freeze({
      ...makeExec('select users generation scope users'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const readPostsExec = Object.freeze({
      ...makeExec('select posts generation scope posts'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'posts' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users generation scope write', {
        uncache: uncacheAnnotation({ uncache: [{ models: ['posts'] }] }),
      }),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readUsersExec, readPostsExec]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUsersExec, ctx)).toBeDefined();
    expect(await mw.intercept!(readPostsExec, ctx)).toBeUndefined();
  });

  it('generation guard deletes stale keys when enabled', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: {
        mode: 'versioned',
        generation: { guard: { enabled: true, maxDeletesPerBump: 10 } },
      },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users generation guard enabled'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users generation guard enabled write'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.inner.size).toBeGreaterThan(0);

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.delSpy).toHaveBeenCalled();
    expect(store.inner.size).toBe(0);
  });

  it('generation guard does not delete stale keys when disabled', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: {
        mode: 'versioned',
        generation: { guard: { enabled: false } },
      },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users generation guard disabled'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users generation guard disabled write'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.delSpy).not.toHaveBeenCalled();
    expect(store.inner.size).toBeGreaterThan(0);
  });

  it('generation guard respects maxDeletesPerBump limit', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: {
        mode: 'versioned',
        generation: { guard: { enabled: true, maxDeletesPerBump: 1 } },
      },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExecA = Object.freeze({
      ...makeExec('select users generation guard limit a'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const readExecB = Object.freeze({
      ...makeExec('select users generation guard limit b'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users generation guard limit write'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readExecA, readExecB]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(store.delSpy).toHaveBeenCalledTimes(1);
    expect(store.inner.size).toBeGreaterThan(1);
    expect(store.inner.size).toBeLessThan(4);
  });

  it('generation guard skips cleanup when store.del is missing', async () => {
    const minimalStore: CacheStore = {
      async get(_key) {
        return undefined;
      },
      async set(_key, _entry, _ttlMs) {},
    };
    const mw = createCacheMiddleware({
      store: minimalStore,
      cacheStrategy: {
        mode: 'versioned',
        generation: { guard: { enabled: true } },
      },
      uncacheOnMutation: true,
    });
    const writeExec = Object.freeze({
      ...makeExec('update users generation guard no-del'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;

    await expect(
      mw.afterExecute!(
        writeExec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        makeCtx(),
      ),
    ).resolves.toBeUndefined();
  });

  it('generation scope action-models-preferred falls back to detected models when actions have no model', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: {
        mode: 'versioned',
        generation: { bumpOn: 'all-writes', scope: 'action-models-preferred' },
      },
      readCaching: true,
      defaultTtlMs: 30_000,
      uncacheOnMutation: true,
    });
    const readUsersExec = Object.freeze({
      ...makeExec('select users generation scope fallback users'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const readPostsExec = Object.freeze({
      ...makeExec('select posts generation scope fallback posts'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'posts' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users generation scope fallback write', {
        uncache: uncacheAnnotation({ uncache: [{ namespace: 'tenant-a' }] }),
      }),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readUsersExec, readPostsExec]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUsersExec, ctx)).toBeUndefined();
    expect(await mw.intercept!(readPostsExec, ctx)).toBeDefined();
  });

  it('emits generation bump and guard cleanup telemetry when stale keys are deleted', async () => {
    const store = spyStore();
    const debugSpy = vi.fn();
    const mw = createCacheMiddleware({
      store,
      cacheStrategy: {
        mode: 'versioned',
        generation: { guard: { enabled: true, maxDeletesPerBump: 10 } },
      },
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users generation telemetry'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update users generation telemetry write'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx({
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: debugSpy },
    });

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );
    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'middleware.cache.generation.bump',
        middleware: 'cache',
        models: ['users'],
      }),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'middleware.cache.generation.guard.cleanup',
        middleware: 'cache',
        models: ['users'],
      }),
    );
  });

  it('does NOT invalidate an unrelated table cache when mutating a different table', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readPostsExec = Object.freeze({
      ...makeExec('select posts only'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'posts' } },
    }) as MockExec;
    const mutateUsersExec = Object.freeze({
      ...makeExec('update users only'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readPostsExec, ctx);
    await mw.onRow!({ id: 1 }, readPostsExec, ctx);
    await mw.afterExecute!(
      readPostsExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      mutateUsersExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readPostsExec, ctx)).toBeDefined();
  });

  it('invalidates only the matching table cache; leaves other tables intact', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readUsersExec = Object.freeze({
      ...makeExec('select users iso'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const readPostsExec = Object.freeze({
      ...makeExec('select posts iso'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'posts' } },
    }) as MockExec;
    const mutateUsersExec = Object.freeze({
      ...makeExec('insert users iso'),
      ast: { kind: 'insert', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readUsersExec, readPostsExec]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    await mw.afterExecute!(
      mutateUsersExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUsersExec, ctx)).toBeUndefined();
    expect(await mw.intercept!(readPostsExec, ctx)).toBeDefined();
  });

  it('model index survives a second mutation after first already deleted the entry', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: true,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readExec = Object.freeze({
      ...makeExec('select users cleanup'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const mutateExec = Object.freeze({
      ...makeExec('update users cleanup'),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      mutateExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );
    await expect(
      mw.afterExecute!(
        mutateExec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      ),
    ).resolves.toBeUndefined();
  });

  it('uncacheAnnotation uncache field on a mutation invalidates specified namespace', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: false,
      readCaching: true,
      defaultTtlMs: 30_000,
      namespace: 'app',
    });
    const readExec = Object.freeze({
      ...makeExec('select users ann-actions'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('insert users ann-actions', {
        uncache: uncacheAnnotation({ uncache: [{ namespace: 'app' }] }),
      }),
      ast: { kind: 'insert', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.intercept!(readExec, ctx);
    await mw.onRow!({ id: 1 }, readExec, ctx);
    await mw.afterExecute!(
      readExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readExec, ctx)).toBeUndefined();
  });

  it('uncacheAnnotation uncache with explicit keys deletes only those keys', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, uncacheOnMutation: false });
    store.inner.set('user:1', { rows: [{ id: 1 }], storedAt: 0 });
    store.inner.set('user:2', { rows: [{ id: 2 }], storedAt: 0 });
    store.inner.set('post:1', { rows: [{ id: 3 }], storedAt: 0 });

    const writeExec = Object.freeze({
      ...makeExec('update users explicit-keys', {
        uncache: uncacheAnnotation({ uncache: [{ keys: ['user:1'] }] }),
      }),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const ctx = makeCtx();

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await store.get('user:1')).toBeUndefined();
    expect(await store.get('user:2')).toBeDefined();
    expect(await store.get('post:1')).toBeDefined();
  });

  it('uncacheAnnotation uncache supports model selector', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      uncacheOnMutation: false,
      readCaching: true,
      defaultTtlMs: 30_000,
    });
    const readUsersExec = Object.freeze({
      ...makeExec('select users ann-model'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'users' } },
    }) as MockExec;
    const readPostsExec = Object.freeze({
      ...makeExec('select posts ann-model'),
      ast: { kind: 'select', from: { kind: 'table-source', name: 'posts' } },
    }) as MockExec;
    const writeExec = Object.freeze({
      ...makeExec('update profile ann-model', {
        uncache: uncacheAnnotation({ uncache: [{ models: ['users'] }] }),
      }),
      ast: { kind: 'update', table: { kind: 'table-source', name: 'profiles' } },
    }) as MockExec;
    const ctx = makeCtx();

    for (const exec of [readUsersExec, readPostsExec]) {
      await mw.intercept!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterExecute!(
        exec,
        { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
        ctx,
      );
    }

    await mw.afterExecute!(
      writeExec,
      { rowCount: 1, latencyMs: 1, completed: true, source: 'driver' },
      ctx,
    );

    expect(await mw.intercept!(readUsersExec, ctx)).toBeUndefined();
    expect(await mw.intercept!(readPostsExec, ctx)).toBeDefined();
  });
});

import type { AfterQueryResult } from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware } from '../src/cache-middleware';
import { createInMemoryCacheStore } from '../src/cache-store';
import { drain, makeCtx, makeExec, runMiss, spyStore } from './middleware-fixtures';

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

  it('passes through when the cache annotation has bypass: true', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ bypass: true }),
    });

    const result = await mw.interceptQuery!(exec, makeCtx());
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('caches an annotation with no options', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', { cache: cacheAnnotation({}) });

    await runMiss(mw, exec, makeCtx(), [{ id: 1 }]);

    expect(store.getSpy).toHaveBeenCalledWith({ key: 'key:select 1', meta: undefined });
    expect(store.setSpy).toHaveBeenCalledTimes(1);
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
    store.inner.set('key:select 1', [{ id: 1 }, { id: 2 }]);

    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
    store.inner.set('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
    store.inner.set('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
    store.inner.set('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
      cache: cacheAnnotation({}),
    });

    const result = await mw.interceptQuery!(exec, makeCtx());
    expect(result).toBeUndefined();
  });

  it('logs a middleware.cache.miss event via ctx.log.debug on a miss', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
      {
        key: 'key:select 1',
        meta: undefined,
        version: 0,
        data: { empty: true },
      },
      [{ id: 1 }, { id: 2 }],
    );
  });

  it('does not commit when completed = false (driver threw mid-stream)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
      cache: cacheAnnotation({}),
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
      cache: cacheAnnotation({}),
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
    const mw = createCacheMiddleware({ store });
    const execA = makeExec('select A', {
      cache: cacheAnnotation({}),
    });
    const execB = makeExec('select B', {
      cache: cacheAnnotation({}),
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

    expect(store.inner.get('key:select A')).toEqual([
      { from: 'A', n: 1 },
      { from: 'A', n: 2 },
    ]);
    expect(store.inner.get('key:select B')).toEqual([
      { from: 'B', n: 1 },
      { from: 'B', n: 2 },
    ]);
  });
});

describe('createCacheMiddleware — scope guard', () => {
  it('passes through when ctx.scope = "connection"', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });

    const result = await mw.interceptQuery!(exec, makeCtx({ scope: 'connection' }));
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
  });

  it('passes through when ctx.scope = "transaction"', async () => {
    const store = spyStore();
    store.inner.set('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });

    const result = await mw.interceptQuery!(exec, makeCtx({ scope: 'transaction' }));
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
  });

  it('does not store rows on connection-scope writes either', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
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
    const mw = createCacheMiddleware();
    const exec = makeExec('select roundtrip', {
      cache: cacheAnnotation({}),
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
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx();

    await mw.interceptQuery!(exec, ctx);
    await mw.onRow!({ id: 7 }, exec, ctx);
    await mw.afterQuery!(
      exec,
      { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
      ctx,
    );

    const stored = await store.get({ key: 'key:custom-not-this', meta: undefined });
    expect(stored.data).toEqual({ empty: true });
    const real = await store.get({ key: 'key:select custom', meta: undefined });
    expect(real.data).toEqual({ empty: false, value: [{ id: 7 }] });
  });
});

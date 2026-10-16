import { describe, expect, it, vi } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware } from '../src/cache-middleware';
import { createInMemoryCacheStore } from '../src/cache-store';
import { drain, endStatement, makeCtx, makeExec, runMiss, spyStore } from './middleware-fixtures';

describe('createCacheMiddleware — opt-in semantics', () => {
  it('passes through (no store interaction) when the plan has no cache annotation', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1'); // no annotations

    const result = await mw.intercept!.onQuery!(exec, makeCtx());
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

    const result = await mw.intercept!.onQuery!(exec, makeCtx());
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

  it('does not store rows for an un-annotated plan even when onRow/activityEnded fire (driver path)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1');
    const ctx = makeCtx();

    await mw.intercept!.onQuery!(exec, ctx); // passthrough
    await mw.onRow!({ id: 1 }, exec, ctx);
    await endStatement(mw, exec, ctx, { rowCount: 1 });

    expect(store.setSpy).not.toHaveBeenCalled();
  });
});

describe('createCacheMiddleware — hit path', () => {
  it('returns cached rows from intercept.onQuery when the store has a non-expired entry', async () => {
    const store = spyStore();
    store.setRows('key:select 1', [{ id: 1 }, { id: 2 }]);

    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });

    const result = await mw.intercept!.onQuery!(exec, makeCtx());
    expect(result).toBeDefined();
    expect(await drain(result!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it('logs a middleware.cache.hit event via ctx.log.debug on a hit', async () => {
    const store = spyStore();
    store.setRows('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });
    const debug = vi.fn();
    const ctx = makeCtx({
      log: { info: () => {}, warn: () => {}, error: () => {}, debug },
    });

    await mw.intercept!.onQuery!(exec, ctx);

    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ event: 'middleware.cache.hit' }));
  });

  it('does not call store.set on the hit path', async () => {
    const store = spyStore();
    store.setRows('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx();

    const result = await mw.intercept!.onQuery!(exec, ctx);
    await drain(result!.rows as AsyncIterable<Record<string, unknown>>);

    // activityEnded fires with source: 'middleware' on a hit; the cache
    // middleware should not write back to the store.
    await endStatement(mw, exec, ctx, { rowCount: 1, source: 'middleware' });

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('survives the absence of ctx.log.debug (it is optional on RuntimeLog)', async () => {
    const store = spyStore();
    store.setRows('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx({
      // No debug field.
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await expect(mw.intercept!.onQuery!(exec, ctx)).resolves.toBeDefined();
  });
});

describe('createCacheMiddleware — miss path', () => {
  it('returns undefined from intercept.onQuery on a miss', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });

    const result = await mw.intercept!.onQuery!(exec, makeCtx());
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

    await mw.intercept!.onQuery!(exec, ctx);

    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ event: 'middleware.cache.miss' }));
  });

  it('buffers rows via onRow and commits on a successful activityEnded (source: driver)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx();

    await mw.intercept!.onQuery!(exec, ctx); // miss
    await mw.onRow!({ id: 1 }, exec, ctx);
    await mw.onRow!({ id: 2 }, exec, ctx);
    await endStatement(mw, exec, ctx, { rowCount: 2 });

    expect(store.setSpy).toHaveBeenCalledTimes(1);
    expect(store.setSpy).toHaveBeenCalledWith(
      {
        key: 'key:select 1',
        meta: undefined,
        version: 0,
        data: { empty: true },
      },
      { kind: 'statement-rows', rows: [{ id: 1 }, { id: 2 }] },
    );
  });

  it('does not commit when the statement failed (driver threw mid-stream)', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx();

    await mw.intercept!.onQuery!(exec, ctx);
    await mw.onRow!({ id: 1 }, exec, ctx);
    await endStatement(mw, exec, ctx, { rowCount: 1, outcome: 'failed' });

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('does not commit when source = "middleware" (a different interceptor produced the rows)', async () => {
    // If another middleware wins the intercept chain, our onQuery did
    // not fire — we never called set up a buffer. activityEnded would see
    // source === 'middleware' and we should not store anything.
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx();

    // Note: skipping onQuery and onRow simulates the case where a
    // different interceptor short-circuited execution upstream.
    await endStatement(mw, exec, ctx, { rowCount: 1, source: 'middleware' });

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('drops its pending miss on activityEnded even when no commit happens', async () => {
    // Verify behavior: re-running activityEnded without an onQuery call
    // should be a no-op even if
    // the previous run did not commit.
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx();

    await mw.intercept!.onQuery!(exec, ctx);
    await mw.onRow!({ id: 1 }, exec, ctx);
    // Mid-stream failure.
    await endStatement(mw, exec, ctx, { rowCount: 1, outcome: 'failed' });

    // A second activityEnded (defensive — should never happen in
    // practice, but verify cleanup didn't leave residue).
    await endStatement(mw, exec, ctx, { rowCount: 1 });

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('keeps each statement buffer in its own ctx.state, isolated across two concurrent statements on the same plan', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const execA = makeExec('select A', {
      cache: cacheAnnotation({}),
    });
    const execB = makeExec('select B', {
      cache: cacheAnnotation({}),
    });
    const ctxA = makeCtx();
    const ctxB = makeCtx();

    // Interleave the two statements to stress per-activity buffer isolation.
    await mw.intercept!.onQuery!(execA, ctxA);
    await mw.intercept!.onQuery!(execB, ctxB);
    await mw.onRow!({ from: 'A', n: 1 }, execA, ctxA);
    await mw.onRow!({ from: 'B', n: 1 }, execB, ctxB);
    await mw.onRow!({ from: 'A', n: 2 }, execA, ctxA);
    await mw.onRow!({ from: 'B', n: 2 }, execB, ctxB);

    await endStatement(mw, execA, ctxA, { rowCount: 2 });
    await endStatement(mw, execB, ctxB, { rowCount: 2 });

    expect(store.rowsAt('key:select A')).toEqual([
      { from: 'A', n: 1 },
      { from: 'A', n: 2 },
    ]);
    expect(store.rowsAt('key:select B')).toEqual([
      { from: 'B', n: 1 },
      { from: 'B', n: 2 },
    ]);
  });
});

describe('createCacheMiddleware — scope guard', () => {
  it('passes through when ctx.scope = "connection"', async () => {
    const store = spyStore();
    store.setRows('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });

    const result = await mw.intercept!.onQuery!(exec, makeCtx({ scope: 'connection' }));
    expect(result).toBeUndefined();
    expect(store.getSpy).not.toHaveBeenCalled();
  });

  it('passes through when ctx.scope = "transaction"', async () => {
    const store = spyStore();
    store.setRows('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({}),
    });

    const result = await mw.intercept!.onQuery!(exec, makeCtx({ scope: 'transaction' }));
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

    await mw.intercept!.onQuery!(exec, ctx);
    await mw.onRow!({ id: 1 }, exec, ctx);
    await endStatement(mw, exec, ctx, { rowCount: 1 });

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

  it('wires intercept.onQuery, onRow, and activityEnded (only)', () => {
    const mw = createCacheMiddleware({ store: spyStore() });
    expect(mw.intercept?.onQuery).toBeDefined();
    expect(mw.intercept?.onExecute).toBeUndefined();
    expect(mw.onRow).toBeDefined();
    expect(mw.activityEnded).toBeDefined();
    expect(mw.beforeEncode).toBeUndefined();
    expect(mw.activityFinalized).toBeUndefined();
  });

  it('roundtrips a miss-then-hit through the default in-memory store', async () => {
    const mw = createCacheMiddleware();
    const exec = makeExec('select roundtrip', {
      cache: cacheAnnotation({}),
    });
    const ctx = makeCtx();

    // Miss.
    expect(await mw.intercept!.onQuery!(exec, ctx)).toBeUndefined();
    await mw.onRow!({ id: 1 }, exec, ctx);
    await mw.onRow!({ id: 2 }, exec, ctx);
    await endStatement(mw, exec, ctx, { rowCount: 2 });

    // Hit on the next call.
    const second = await mw.intercept!.onQuery!(exec, ctx);
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

    await mw.intercept!.onQuery!(exec, ctx);
    await mw.onRow!({ id: 7 }, exec, ctx);
    await endStatement(mw, exec, ctx, { rowCount: 1 });

    const stored = await store.get({ key: 'key:custom-not-this', meta: undefined });
    expect(stored.data).toEqual({ empty: true });
    const real = await store.get({ key: 'key:select custom', meta: undefined });
    expect(real.data).toEqual({
      empty: false,
      value: { kind: 'statement-rows', rows: [{ id: 7 }] },
    });
  });
});

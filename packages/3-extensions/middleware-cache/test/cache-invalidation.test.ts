import type { RuntimeMiddlewareContext } from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { type CacheMiddleware, createCacheMiddleware } from '../src/cache-middleware';
import { type MockExec, makeCtx, makeExec, runMiss, spyStore } from './middleware-fixtures';

async function startMiss(
  mw: CacheMiddleware,
  ctx: RuntimeMiddlewareContext,
  key: string,
  meta?: unknown,
): Promise<MockExec> {
  const exec = makeExec(`select ${key}`, { cache: cacheAnnotation({ key, meta }) });
  await mw.interceptQuery?.(exec, ctx);
  await mw.onRow?.({ id: 1 }, exec, ctx);
  return exec;
}

async function finishMiss(
  mw: CacheMiddleware,
  exec: MockExec,
  ctx: RuntimeMiddlewareContext,
): Promise<void> {
  await mw.afterQuery?.(
    exec,
    { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
    ctx,
  );
}

function debugCtx() {
  const debug = vi.fn();
  const ctx = makeCtx({ log: { info: () => {}, warn: () => {}, error: () => {}, debug } });
  return { ctx, debug };
}

const skipped = (key: string) => ({
  event: 'middleware.cache.store-skipped',
  middleware: 'cache',
  key,
});

describe('createCacheMiddleware — invalidate', () => {
  it('unsets keys in one store call', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await mw.invalidate({ keys: ['user-1', 'user-2'] });

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: ['user-1', 'user-2'], meta: undefined }]]);
  });

  it('unsets by meta in one store call', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await mw.invalidate({ meta: { tags: ['users'] } });

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: undefined, meta: { tags: ['users'] } }]]);
  });

  it('unsets keys and meta together in one store call', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await mw.invalidate({ keys: ['user-1'], meta: { tags: ['users'] } });

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: ['user-1'], meta: { tags: ['users'] } }]]);
  });

  it('passes keys: undefined when keys are empty and meta is given', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await mw.invalidate({ keys: [], meta: { tags: ['users'] } });

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: undefined, meta: { tags: ['users'] } }]]);
  });

  it('treats meta: null as a meta to unset', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await mw.invalidate({ meta: null });

    expect(store.unsetSpy.mock.calls).toEqual([[{ keys: undefined, meta: null }]]);
  });

  it('removes a cached entry so the next read misses', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', { cache: cacheAnnotation({ key: 'user-1' }) });
    const ctx = makeCtx();
    await runMiss(mw, exec, ctx, [{ id: 1 }]);
    expect(await mw.interceptQuery?.(exec, ctx)).toBeDefined();

    await mw.invalidate({ keys: ['user-1'] });

    expect(await mw.interceptQuery?.(exec, ctx)).toBeUndefined();
  });

  it.each([
    ['an empty target', {}],
    ['empty keys', { keys: [] }],
  ])('does nothing for %s, so an overlapping miss still stores', async (_label, target) => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const ctx = makeCtx();
    const exec = await startMiss(mw, ctx, 'user-1');

    await mw.invalidate(target);
    await finishMiss(mw, exec, ctx);

    expect(store.unsetSpy).not.toHaveBeenCalled();
    expect(store.setSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates a store error', async () => {
    const store = spyStore();
    const failure = new Error('unset failed');
    store.unsetSpy.mockRejectedValueOnce(failure);
    const mw = createCacheMiddleware({ store });

    await expect(mw.invalidate({ keys: ['user-1'] })).rejects.toBe(failure);
  });

  it('rejects a meta target against the default store', async () => {
    const mw = createCacheMiddleware();

    await expect(mw.invalidate({ meta: { tags: ['users'] } })).rejects.toMatchObject({
      code: 'RUNTIME.CACHE_STORE_META_UNSUPPORTED',
    });
  });
});

describe('createCacheMiddleware — misses overlapping invalidate', () => {
  it('passes the entry get returned, with its version, to set', async () => {
    const store = spyStore();
    store.versions.set('A', 7);
    const mw = createCacheMiddleware({ store });
    const ctx = makeCtx();

    await finishMiss(mw, await startMiss(mw, ctx, 'A'), ctx);

    expect(store.setSpy).toHaveBeenCalledWith(
      {
        key: 'A',
        meta: undefined,
        version: 7,
        data: { empty: true },
      },
      [{ id: 1 }],
    );
  });

  it('stores a miss for key A that overlapped invalidate({ keys: ["B"] })', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const ctx = makeCtx();
    const exec = await startMiss(mw, ctx, 'A');

    await mw.invalidate({ keys: ['B'] });
    await finishMiss(mw, exec, ctx);

    expect(store.inner.get('A')).toEqual([{ id: 1 }]);
  });

  it('does not store a miss for key A that overlapped invalidate({ keys: ["A"] }), and logs the skip', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const { ctx, debug } = debugCtx();
    const exec = await startMiss(mw, ctx, 'A');

    await mw.invalidate({ keys: ['A'] });
    await finishMiss(mw, exec, ctx);

    expect(await store.setSpy.mock.results[0]?.value).toBe(false);
    expect(store.inner.has('A')).toBe(false);
    expect(debug).toHaveBeenCalledWith(skipped('A'));
  });

  it('does not store a miss for a key the store has never seen that overlapped an invalidate({ meta }) naming its meta', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const { ctx, debug } = debugCtx();
    const exec = await startMiss(mw, ctx, 'never-seen', { tags: ['users'] });

    await mw.invalidate({ meta: { tags: ['users'] } });
    await finishMiss(mw, exec, ctx);

    expect(store.inner.has('never-seen')).toBe(false);
    expect(debug).toHaveBeenCalledWith(skipped('never-seen'));
  });

  it('stores a miss whose meta differs from the meta an overlapping invalidate names', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const ctx = makeCtx();
    const exec = await startMiss(mw, ctx, 'A', { tags: ['posts'] });

    await mw.invalidate({ meta: { tags: ['users'] } });
    await finishMiss(mw, exec, ctx);

    expect(store.inner.get('A')).toEqual([{ id: 1 }]);
  });

  it('stores a miss with meta that started after an invalidate({ meta }) naming that meta', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const ctx = makeCtx();

    await mw.invalidate({ meta: { tags: ['users'] } });
    await finishMiss(mw, await startMiss(mw, ctx, 'A', { tags: ['users'] }), ctx);

    expect(store.inner.get('A')).toEqual([{ id: 1 }]);
  });

  it('stores a miss that started after an invalidate', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const ctx = makeCtx();

    await mw.invalidate({ keys: ['A'] });
    await finishMiss(mw, await startMiss(mw, ctx, 'A'), ctx);

    expect(store.inner.get('A')).toEqual([{ id: 1 }]);
  });

  it('logs the store when set returns true', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const { ctx, debug } = debugCtx();

    await finishMiss(mw, await startMiss(mw, ctx, 'A'), ctx);

    expect(debug).toHaveBeenCalledWith({
      event: 'middleware.cache.store',
      middleware: 'cache',
      key: 'A',
    });
    expect(debug).not.toHaveBeenCalledWith(skipped('A'));
  });
});

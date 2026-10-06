import type {
  ExecutionPlan,
  RuntimeMiddlewareContext,
} from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { type CacheAnnotationOptions, cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware, deriveKeyFromContentHash } from '../src/cache-middleware';
import { makeCtx, makeExec, runMiss, spyStore } from './middleware-fixtures';

function deriveKeySpy() {
  return vi.fn(async (_exec: ExecutionPlan, _ctx: RuntimeMiddlewareContext) => 'derived');
}

describe('deriveKeyFromContentHash', () => {
  it('returns the content hash of the plan', async () => {
    const exec = makeExec('select 1');

    expect(await deriveKeyFromContentHash(exec, makeCtx())).toBe('key:select 1');
  });
});

describe('createCacheMiddleware — deriveKey', () => {
  it('uses the derived key for get and set', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, deriveKey: async () => 'users:1' });
    const exec = makeExec('select 1', { cache: cacheAnnotation({}) });

    await runMiss(mw, exec, makeCtx(), [{ id: 1 }]);

    expect(store.getSpy).toHaveBeenCalledWith({ key: 'users:1', meta: undefined });
    expect(store.setSpy).toHaveBeenCalledWith(
      {
        key: 'users:1',
        meta: undefined,
        version: 0,
        data: { empty: true },
      },
      expect.anything(),
    );
  });

  it('accepts a synchronous deriveKey', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store, deriveKey: () => 'sync-key' });
    const exec = makeExec('select 1', { cache: cacheAnnotation({}) });

    await runMiss(mw, exec, makeCtx(), [{ id: 1 }]);

    expect(store.setSpy).toHaveBeenCalledWith(
      {
        key: 'sync-key',
        meta: undefined,
        version: 0,
        data: { empty: true },
      },
      expect.anything(),
    );
  });

  it('is called once per miss-then-store, with the exec and ctx of the read', async () => {
    const deriveKey = deriveKeySpy();
    const mw = createCacheMiddleware({ store: spyStore(), deriveKey });
    const exec = makeExec('select 1', { cache: cacheAnnotation({}) });
    const ctx = makeCtx();

    await runMiss(mw, exec, ctx, [{ id: 1 }]);

    expect(deriveKey.mock.calls).toEqual([[exec, ctx]]);
  });

  it('composes with deriveKeyFromContentHash', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({
      store,
      deriveKey: async (exec, ctx) => `users:${await deriveKeyFromContentHash(exec, ctx)}`,
    });
    const exec = makeExec('select 1', { cache: cacheAnnotation({}) });

    await runMiss(mw, exec, makeCtx(), [{ id: 1 }]);

    expect(store.setSpy).toHaveBeenCalledWith(
      {
        key: 'users:key:select 1',
        meta: undefined,
        version: 0,
        data: { empty: true },
      },
      expect.anything(),
    );
  });

  it('is not called when the annotation sets a key', async () => {
    const store = spyStore();
    const deriveKey = deriveKeySpy();
    const mw = createCacheMiddleware({ store, deriveKey });
    const exec = makeExec('select 1', {
      cache: cacheAnnotation({ key: 'user-1' }),
    });

    await runMiss(mw, exec, makeCtx(), [{ id: 1 }]);

    expect(deriveKey).not.toHaveBeenCalled();
    expect(store.setSpy).toHaveBeenCalledWith(
      {
        key: 'user-1',
        meta: undefined,
        version: 0,
        data: { empty: true },
      },
      expect.anything(),
    );
  });

  describe('is not called on a read the cache bypasses', () => {
    const bypassed: readonly {
      readonly name: string;
      readonly payload: CacheAnnotationOptions | undefined;
      readonly scope: RuntimeMiddlewareContext['scope'];
    }[] = [
      { name: 'no annotation', payload: undefined, scope: 'runtime' },
      { name: 'bypass: true', payload: { bypass: true }, scope: 'runtime' },
      { name: 'connection scope', payload: {}, scope: 'connection' },
      { name: 'transaction scope', payload: {}, scope: 'transaction' },
    ];

    for (const { name, payload, scope } of bypassed) {
      it(name, async () => {
        const deriveKey = deriveKeySpy();
        const mw = createCacheMiddleware({ store: spyStore(), deriveKey });
        const exec =
          payload === undefined
            ? makeExec('select 1')
            : makeExec('select 1', { cache: cacheAnnotation(payload) });

        await runMiss(mw, exec, makeCtx({ scope }), [{ id: 1 }]);

        expect(deriveKey).not.toHaveBeenCalled();
      });
    }
  });

  it('fails the read when it throws, without reading or writing the store', async () => {
    const store = spyStore();
    const failure = new Error('derive failed');
    const mw = createCacheMiddleware({
      store,
      deriveKey: () => {
        throw failure;
      },
    });
    const exec = makeExec('select 1', { cache: cacheAnnotation({}) });

    await expect(mw.interceptQuery?.(exec, makeCtx())).rejects.toBe(failure);
    expect(store.getSpy).not.toHaveBeenCalled();
    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it('defaults to the content hash', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', { cache: cacheAnnotation({}) });

    await runMiss(mw, exec, makeCtx(), [{ id: 1 }]);

    expect(store.setSpy).toHaveBeenCalledWith(
      {
        key: 'key:select 1',
        meta: undefined,
        version: 0,
        data: { empty: true },
      },
      expect.anything(),
    );
  });
});

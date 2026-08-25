import type { PlanMeta } from '@internal/contract/types';
import type {
  ExecutionPlan,
  RuntimeMiddlewareContext,
} from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware } from '../src/cache-middleware';
import type { CachedEntry, CacheStore } from '../src/cache-store';

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
    contentHash: async (exec) => `id:${(exec as MockExec).statement}`,
    scope: 'runtime',
    planExecutionId: 'test-fixture-plan-execution-id',
    ...overrides,
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

async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('cache key resolution', () => {
  describe('default path: ctx.contentHash(exec)', () => {
    it('uses the contentHash return value as the cache map key (no rehashing)', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation({ ttl: 60_000 }),
      });
      const ctx = makeCtx();

      // Miss → store.get and store.set both called with the contentHash.
      await mw.interceptQuery!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterQuery!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.getSpy).toHaveBeenCalledWith('id:select 1');
      expect(store.setSpy).toHaveBeenCalledWith('id:select 1', expect.anything(), 60_000);
    });

    it('invokes ctx.contentHash when no per-query key annotation is supplied', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation({ ttl: 60_000 }),
      });
      const contentHash = vi.fn(async (e: ExecutionPlan) => `derived:${(e as MockExec).statement}`);
      const ctx = makeCtx({ contentHash });

      await mw.interceptQuery!(exec, ctx);

      expect(contentHash).toHaveBeenCalledTimes(1);
      expect(contentHash).toHaveBeenCalledWith(exec);
      expect(store.getSpy).toHaveBeenCalledWith('derived:select 1');
    });

    it('produces distinct cache entries for two execs with distinct contentHash returns', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store, clock: () => 0 });
      const execA = makeExec('A', {
        cache: cacheAnnotation({ ttl: 60_000 }),
      });
      const execB = makeExec('B', {
        cache: cacheAnnotation({ ttl: 60_000 }),
      });
      const ctx = makeCtx();

      // Miss + commit for A.
      await mw.interceptQuery!(execA, ctx);
      await mw.onRow!({ from: 'A' }, execA, ctx);
      await mw.afterQuery!(
        execA,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      // Miss + commit for B.
      await mw.interceptQuery!(execB, ctx);
      await mw.onRow!({ from: 'B' }, execB, ctx);
      await mw.afterQuery!(
        execB,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.inner.size).toBe(2);
      expect(store.inner.get('id:A')?.rows).toEqual([{ from: 'A' }]);
      expect(store.inner.get('id:B')?.rows).toEqual([{ from: 'B' }]);
    });
  });

  describe('per-query override: cacheAnnotation({ key })', () => {
    it('uses the user-supplied key in place of ctx.contentHash', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation({ ttl: 60_000, key: 'custom-key' }),
      });
      const ctx = makeCtx();

      await mw.interceptQuery!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterQuery!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.getSpy).toHaveBeenCalledWith('custom-key');
      expect(store.setSpy).toHaveBeenCalledWith('custom-key', expect.anything(), 60_000);
    });

    it('does not invoke ctx.contentHash when an override key is supplied', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select 1', {
        cache: cacheAnnotation({ ttl: 60_000, key: 'custom-key' }),
      });
      const contentHash = vi.fn(async () => 'should-not-be-used');
      const ctx = makeCtx({ contentHash });

      await mw.interceptQuery!(exec, ctx);

      expect(contentHash).not.toHaveBeenCalled();
    });

    it('stores user-supplied keys verbatim (no rehashing)', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store });
      // A long, structured user key — verify the middleware does not
      // mangle, hash, or otherwise transform it.
      const userKey = 'tenant=acme|user=alice|page=42';
      const exec = makeExec('select 1', {
        cache: cacheAnnotation({ ttl: 60_000, key: userKey }),
      });
      const ctx = makeCtx();

      await mw.interceptQuery!(exec, ctx);
      await mw.onRow!({ id: 1 }, exec, ctx);
      await mw.afterQuery!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      expect(store.inner.has(userKey)).toBe(true);
    });

    it('produces a hit using the user-supplied key when previously committed under it', async () => {
      const store = spyStore();
      store.inner.set('shared-key', {
        rows: [{ id: 'pre-cached' }],
        storedAt: 0,
      });

      const mw = createCacheMiddleware({ store });
      const exec = makeExec('select anything', {
        cache: cacheAnnotation({ ttl: 60_000, key: 'shared-key' }),
      });
      const ctx = makeCtx();

      const result = await mw.interceptQuery!(exec, ctx);
      expect(result).toBeDefined();
      expect(await drain(result!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
        { id: 'pre-cached' },
      ]);
    });
  });

  describe('cross-family parity', () => {
    it('works with a Mongo-style contentHash return value (no SQL fields read)', async () => {
      // The cache middleware must not read exec.sql, exec.command, or any
      // family-specific field. Use a "Mongo-shaped" mock plan and a
      // Mongo-style contentHash to demonstrate the package is genuinely
      // family-agnostic.
      interface MongoLikeExec extends ExecutionPlan {
        readonly command: { readonly kind: string; readonly filter: unknown };
      }

      const store = spyStore();
      const mw = createCacheMiddleware({ store });

      const exec: MongoLikeExec = Object.freeze({
        command: { kind: 'find', filter: { active: true } },
        meta: {
          ...baseMeta,
          target: 'mongo',
          targetFamily: 'mongo',
          annotations: {
            cache: cacheAnnotation({ ttl: 60_000 }),
          },
        },
      });

      const ctx = makeCtx({
        contentHash: async () => 'mongo:users:find:{active:true}',
      });

      // Miss + commit.
      await mw.interceptQuery!(exec, ctx);
      await mw.onRow!({ _id: 'a', active: true }, exec, ctx);
      await mw.afterQuery!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctx,
      );

      // Hit on the second call.
      const second = await mw.interceptQuery!(exec, ctx);
      expect(second).toBeDefined();
      expect(await drain(second!.rows as AsyncIterable<Record<string, unknown>>)).toEqual([
        { _id: 'a', active: true },
      ]);
      expect(store.inner.has('mongo:users:find:{active:true}')).toBe(true);
    });

    it('two distinct contentHash returns produce two distinct cache entries', async () => {
      const store = spyStore();
      const mw = createCacheMiddleware({ store, clock: () => 0 });
      const exec = makeExec('shared statement', {
        cache: cacheAnnotation({ ttl: 60_000 }),
      });

      // Same exec object but two different ctx.contentHash returns —
      // simulating two calls where the family runtime computed different
      // canonical keys (e.g. a parameter changed but the AST/command is
      // structurally identical at this view).
      const ctxA = makeCtx({ contentHash: async () => 'key-A' });
      const ctxB = makeCtx({ contentHash: async () => 'key-B' });

      // Commit under key-A.
      await mw.interceptQuery!(exec, ctxA);
      await mw.onRow!({ from: 'A' }, exec, ctxA);
      await mw.afterQuery!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctxA,
      );

      // Commit under key-B.
      await mw.interceptQuery!(exec, ctxB);
      await mw.onRow!({ from: 'B' }, exec, ctxB);
      await mw.afterQuery!(
        exec,
        { rowCount: 1, latencyMs: 0, completed: true, source: 'driver' },
        ctxB,
      );

      expect(store.inner.size).toBe(2);
      expect(store.inner.get('key-A')?.rows).toEqual([{ from: 'A' }]);
      expect(store.inner.get('key-B')?.rows).toEqual([{ from: 'B' }]);
    });
  });
});

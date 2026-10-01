import type { PlanMeta } from '@internal/contract/types';
import type {
  CrossFamilyMiddleware,
  ExecutionPlan,
  RuntimeMiddlewareContext,
} from '@internal/framework-components/runtime';
import { vi } from 'vitest';
import type { CacheEntry, CacheStore } from '../src/cache-store';

export interface MockExec extends ExecutionPlan {
  readonly statement: string;
}

export const baseMeta: PlanMeta = {
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'test',
  lane: 'orm',
};

export function makeExec(statement: string, annotations?: Record<string, unknown>): MockExec {
  return Object.freeze({
    statement,
    meta: annotations ? { ...baseMeta, annotations } : baseMeta,
  });
}

export function makeCtx(overrides?: Partial<RuntimeMiddlewareContext>): RuntimeMiddlewareContext {
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

type Rows = readonly Record<string, unknown>[];

/**
 * A versioned in-memory store for middleware tests that matches `meta` by value. It keeps a version
 * per key and one per `meta` value, and folds the version of the given `meta` into the version
 * `get` returns and `set` compares, so an `unset` by `meta` refuses an overlapping `set` even for a
 * key the store has never seen.
 */
export function spyStore() {
  const inner = new Map<string, Rows>();
  const entryMeta = new Map<string, string>();
  const versions = new Map<string, number>();
  const metaVersions = new Map<string, number>();
  const metaId = (meta: unknown) => JSON.stringify(meta);
  const versionOf = (key: string, meta: unknown) =>
    (versions.get(key) ?? 0) + (meta === undefined ? 0 : (metaVersions.get(metaId(meta)) ?? 0));
  const removeKey = (key: string) => {
    versions.set(key, (versions.get(key) ?? 0) + 1);
    inner.delete(key);
    entryMeta.delete(key);
  };
  const getSpy = vi.fn(
    async (target: Parameters<CacheStore['get']>[0]): Promise<CacheEntry<unknown, Rows>> => {
      const value = inner.get(target.key);
      return {
        key: target.key,
        meta: target.meta,
        version: versionOf(target.key, target.meta),
        data: value === undefined ? { empty: true } : { empty: false, value },
      };
    },
  );
  const setSpy = vi.fn(async (entry: CacheEntry<unknown, Rows>, value: Rows) => {
    if (entry.version !== versionOf(entry.key, entry.meta)) {
      return false;
    }
    inner.set(entry.key, value);
    if (entry.meta !== undefined) {
      entryMeta.set(entry.key, metaId(entry.meta));
    }
    return true;
  });
  const unsetSpy = vi.fn(async (target: Parameters<CacheStore['unset']>[0]) => {
    for (const key of target.keys ?? []) {
      removeKey(key);
    }
    if (target.meta !== undefined) {
      const id = metaId(target.meta);
      metaVersions.set(id, (metaVersions.get(id) ?? 0) + 1);
      for (const [key, keyMeta] of [...entryMeta]) {
        if (keyMeta === id) {
          removeKey(key);
        }
      }
    }
  });
  const store: CacheStore<unknown, Rows> = { get: getSpy, set: setSpy, unset: unsetSpy };
  return { ...store, getSpy, setSpy, unsetSpy, inner, versions };
}

export async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

export async function runMiss(
  mw: CrossFamilyMiddleware,
  exec: ExecutionPlan,
  ctx: RuntimeMiddlewareContext,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  await mw.interceptQuery?.(exec, ctx);
  for (const row of rows) {
    await mw.onRow?.(row, exec, ctx);
  }
  await mw.afterQuery?.(
    exec,
    { rowCount: rows.length, latencyMs: 0, completed: true, source: 'driver' },
    ctx,
  );
}

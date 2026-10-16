import type { PlanMeta } from '@internal/contract/types';
import type {
  ActivityContext,
  ClientActivity,
  ClientActivityEnded,
  CrossFamilyMiddleware,
  ExecutionPlan,
  StatementActivity,
  StatementEnded,
} from '@internal/framework-components/runtime';
import { vi } from 'vitest';
import type { CachedValue, CacheEntry, CacheStore } from '../src/cache-store';

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

/** A fresh context, as one statement activity has: its own state, no parent. */
export function makeCtx(overrides?: Partial<ActivityContext>): ActivityContext {
  const states = new Map<string | symbol, Record<string | symbol, unknown>>();
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    contentHash: async (exec) => `key:${(exec as MockExec).statement}`,
    scope: 'runtime',
    parent: undefined,
    state(key) {
      const state = states.get(key) ?? {};
      states.set(key, state);
      return state;
    },
    inTransaction: () => false,
    ...overrides,
  };
}

type Rows = readonly Record<string, unknown>[];
type Value = CachedValue;

/**
 * A versioned in-memory store for middleware tests that matches `meta` by value. It keeps a version
 * per key and one per `meta` value, and folds the version of the given `meta` into the version
 * `get` returns and `set` compares, so an `unset` by `meta` refuses an overlapping `set` even for a
 * key the store has never seen.
 */
export function spyStore() {
  const inner = new Map<string, Value>();
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
    async (target: Parameters<CacheStore['get']>[0]): Promise<CacheEntry<unknown, Value>> => {
      const value = inner.get(target.key);
      return {
        key: target.key,
        meta: target.meta,
        version: versionOf(target.key, target.meta),
        data: value === undefined ? { empty: true } : { empty: false, value },
      };
    },
  );
  const setSpy = vi.fn(async (entry: CacheEntry<unknown, Value>, value: Value) => {
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
  const store: CacheStore<unknown, Value> = { get: getSpy, set: setSpy, unset: unsetSpy };
  /** Stores statement rows under `key`, as a read the middleware cached does. */
  const setRows = (key: string, rows: Rows) => inner.set(key, { kind: 'statement-rows', rows });
  /** The statement rows stored under `key`, or what is stored there when it is not rows. */
  const rowsAt = (key: string) => {
    const value = inner.get(key);
    return value?.kind === 'statement-rows' ? value.rows : value;
  };
  return { ...store, getSpy, setSpy, unsetSpy, inner, versions, setRows, rowsAt };
}

export async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

export interface EndedAs {
  readonly rowCount: number;
  readonly outcome?: StatementEnded['outcome'];
  readonly source?: StatementEnded['source'];
}

/** Runs the middleware's `activityEnded` for a query statement over `exec`. */
export async function endStatement(
  mw: CrossFamilyMiddleware,
  exec: ExecutionPlan,
  ctx: ActivityContext,
  ended: EndedAs,
): Promise<void> {
  const activity: StatementActivity = {
    id: 'statement',
    kind: 'statement',
    returns: 'rows',
    plan: exec,
    annotations: new Map(),
  };
  await mw.activityEnded?.(
    activity,
    {
      kind: 'statement',
      returns: 'rows',
      rowCount: ended.rowCount,
      latencyMs: 0,
      outcome: ended.outcome ?? 'succeeded',
      source: ended.source ?? 'driver',
    },
    ctx,
  );
}

export async function runMiss(
  mw: CrossFamilyMiddleware,
  exec: ExecutionPlan,
  ctx: ActivityContext,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  await mw.intercept?.onQuery?.(exec, ctx);
  for (const row of rows) {
    await mw.onRow?.(row, exec, ctx);
  }
  await endStatement(mw, exec, ctx, { rowCount: rows.length });
}

/** A client activity, such as an ORM call, carrying `annotations`. */
export function makeCall(
  annotations: Record<string, unknown> = {},
  contentHash: () => Promise<string> = async () => 'call-hash',
): ClientActivity {
  return {
    id: 'call',
    kind: 'orm-call',
    contentHash,
    annotations: new Map(Object.entries(annotations)) as ClientActivity['annotations'],
  };
}

/** Runs the middleware's `activityEnded` for a client activity. */
export async function endCall(
  mw: CrossFamilyMiddleware,
  activity: ClientActivity,
  ctx: ActivityContext,
  ended: Partial<Pick<ClientActivityEnded, 'outcome' | 'source'>> & { readonly result?: unknown },
): Promise<void> {
  await mw.activityEnded?.(
    activity,
    {
      kind: activity.kind,
      outcome: ended.outcome ?? 'succeeded',
      source: ended.source ?? 'client',
      ...('result' in ended ? { result: ended.result } : {}),
    },
    ctx,
  );
}

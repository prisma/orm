import type {
  AfterExecuteResult,
  CrossFamilyMiddleware,
  ExecutionPlan,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { type CachePayload, cacheAnnotation } from './cache-annotation';
import {
  CACHE_INTERNAL_GENERATION_PREFIX,
  type CacheStore,
  createInMemoryCacheStore,
} from './cache-store';
import { type UncacheAction, uncacheAnnotation } from './uncache-annotation';

/**
 * The value returned by `createCacheMiddleware`.
 *
 * Extends `CrossFamilyMiddleware` with a standalone `uncache` method
 * that lets callers invalidate cache entries outside of an annotated
 * mutation — useful for manual/batch invalidation flows.
 */
export type CacheMiddleware = CrossFamilyMiddleware & {
  readonly uncache: (actions: readonly UncacheAction[]) => Promise<void>;
};

export type CacheStrategyMode = 'broad' | 'targeted' | 'versioned';

export type GenerationScope = 'detected-models' | 'action-models-preferred';
export type GenerationBumpOn = 'uncache' | 'all-writes';

export interface GenerationGuardConfig {
  readonly enabled?: boolean;
  readonly maxDeletesPerBump?: number;
}

export interface GenerationStrategyConfig {
  readonly scope?: GenerationScope;
  readonly bumpOn?: GenerationBumpOn;
  readonly guard?: GenerationGuardConfig;
}

export interface CacheStrategyConfig {
  readonly mode?: CacheStrategyMode;
  readonly generation?: GenerationStrategyConfig;
}

export type CacheStoreOperationMode = 'await' | 'detached';

/**
 * A string that names a cache namespace. Supports:
 * - Exact strings: `"tenant-a"`
 * - Glob wildcards: `"organization:*"` — `*` matches any sequence of characters.
 * - RegExp syntax: `/pattern/` — patterns wrapped in `/…/` are treated as a
 *   regular expression applied via `new RegExp(inner).test(namespace)`.
 */
export type NamespacePattern = string;

/**
 * Per-namespace settings that override the global `CacheMiddlewareOptions`
 * defaults for every execution whose effective namespace matches the pattern.
 *
 * All fields are optional. When a field is absent the global option is used
 * as the fallback.
 *
 * - `store` — name of a registered store from `CacheMiddlewareOptions.stores`.
 *   When set, executions that match this namespace read from and write to the
 *   named store instead of the default store.
 * - All other fields mirror the corresponding `CacheMiddlewareOptions` fields
 *   and override them for matching namespaces.
 */
export interface NamespaceConfig {
  readonly store?: string;
  readonly readCaching?: boolean;
  readonly readDedupe?: boolean;
  readonly defaultTtlMs?: number;
  readonly uncacheOnMutation?: boolean;
  readonly storeOperationMode?: CacheStoreOperationMode;
  readonly cacheStrategy?: CacheStrategyConfig;
}

export async function uncache(
  middleware: Pick<CacheMiddleware, 'uncache'>,
  actions: readonly UncacheAction[],
): Promise<void> {
  await middleware.uncache(actions);
}

/**
 * Options accepted by `createCacheMiddleware`.
 *
 * - `store` — pluggable cache backend. Defaults to an in-process LRU
 *   produced by `createInMemoryCacheStore`. Users supply Redis,
 *   Memcached, or any other backend by implementing the `CacheStore`
 *   interface.
 * - `maxEntries` — only consulted when `store` is omitted. Sets the
 *   `maxEntries` cap on the default in-memory store. Defaults to 1000.
 * - `clock` — injectable time source for `storedAt` stamping on
 *   committed entries. Defaults to `Date.now`. Tests inject a controlled
 *   clock to make commit-time observable. Note: TTL math lives inside
 *   the store, not the middleware — supplying a clock here only affects
 *   the `storedAt` field on committed `CachedEntry` values.
 * - `storeOperationMode` — controls whether store-side write/delete work
 *   is awaited on the execution path. `await` (default) preserves strict
 *   completion semantics. `detached` runs store work in the background to
 *   reduce response-time impact at the cost of eventual consistency and
 *   best-effort error handling.
 */
export interface CacheMiddlewareOptions {
  readonly store?: CacheStore;
  readonly maxEntries?: number;
  readonly clock?: () => number;
  readonly storeOperationMode?: CacheStoreOperationMode;
  readonly cacheStrategy?: CacheStrategyConfig;
  readonly readCaching?: boolean;
  readonly readDedupe?: boolean;
  readonly defaultTtlMs?: number;
  readonly namespace?: string;
  readonly uncacheOnMutation?: boolean;
  /**
   * Named store registry. Keys are arbitrary store identifiers used in
   * `NamespaceConfig.store` and `cacheAnnotation({ store })`. When a name
   * cannot be resolved the middleware falls back to the default store.
   */
  readonly stores?: Record<string, CacheStore>;
  /**
   * Per-namespace configuration. Keys are `NamespacePattern` strings (exact,
   * glob `*`, or `/regex/`). The most specific matching pattern (longest key
   * first, exact match wins over patterns) is merged over the global options
   * for every execution whose effective namespace matches.
   */
  readonly namespaces?: Record<NamespacePattern, NamespaceConfig>;
}

/**
 * Per-execution buffer correlated with the post-lowering `exec` object
 * via a private `WeakMap`. Each in-flight cache miss owns one of these.
 *
 * The plan-identity invariant required by this `WeakMap` correlation is
 * documented in the runtime subsystem doc and pinned by a regression
 * test: family runtimes produce a fresh, frozen `exec` per call (SQL
 * `executeAgainstQueryable` constructs `Object.freeze({...lowered, ...})`
 * on each invocation; Mongo lowers fresh per call). If a future plan-
 * memoization change ever recycles `exec` objects across calls, this
 * correlation would silently leak rows between concurrent executions
 * — which is exactly what the regression test catches.
 */
interface PendingMiss {
  readonly key: string;
  readonly ttlMs: number;
  readonly models: readonly string[];
  readonly entitySelectors: readonly EntitySelector[];
  readonly tags?: readonly string[] | undefined;
  readonly buffer: Record<string, unknown>[];
  readonly resolvedConfig: ResolvedExecConfig;
}

interface InflightMiss {
  readonly promise: Promise<readonly Record<string, unknown>[] | undefined>;
  readonly resolve: (rows: readonly Record<string, unknown>[] | undefined) => void;
}

/**
 * A named cache backend together with the in-process mutable state that
 * belongs to it (key indexes, generation counters, in-flight dedup map).
 * One `StoreHandle` is created per entry in `CacheMiddlewareOptions.stores`
 * plus one for the default store.
 */
interface StoreHandle {
  readonly name: string;
  readonly store: CacheStore;
  readonly modelKeyIndex: Map<string, Set<string>>;
  readonly entityKeyIndex: Map<string, Set<string>>;
  readonly modelGenerations: Map<string, number>;
  readonly inflightMisses: Map<string, InflightMiss>;
}

/**
 * All per-execution resolved settings, merging global `CacheMiddlewareOptions`
 * with the winning `NamespaceConfig` entry (if any) and the annotation-level
 * store override.
 */
interface ResolvedExecConfig {
  readonly storeHandle: StoreHandle;
  readonly strategy: CacheStrategyDefinition;
  readonly useGenerationKeys: boolean;
  readonly useGenerationCleanup: boolean;
  readonly generationScope: GenerationScope;
  readonly generationBumpOn: GenerationBumpOn;
  readonly generationGuardEnabled: boolean;
  readonly generationGuardMaxDeletes: number;
  readonly storeOperationMode: CacheStoreOperationMode;
  readonly readCaching: boolean;
  readonly readDedupe: boolean;
  readonly defaultTtlMs: number | undefined;
  readonly uncacheOnMutation: boolean;
}

interface EntitySelector {
  readonly model: string;
  readonly tableName: string;
  readonly id: string;
  readonly columns: readonly string[];
}

interface GenerationBumpResult {
  readonly models: readonly string[];
  readonly deletedKeys: number;
}

interface CacheStrategyDefinition {
  readonly mode: CacheStrategyMode;
  readonly useReadEntitySelectors: boolean;
  readonly useWriteEntitySelectors: boolean;
  readonly useGenerationKeys: boolean;
  readonly useGenerationCleanup: boolean;
}

const CACHE_STRATEGY_DEFINITIONS: Record<CacheStrategyMode, CacheStrategyDefinition> = {
  broad: {
    mode: 'broad',
    useReadEntitySelectors: false,
    useWriteEntitySelectors: false,
    useGenerationKeys: false,
    useGenerationCleanup: false,
  },
  targeted: {
    mode: 'targeted',
    useReadEntitySelectors: true,
    useWriteEntitySelectors: true,
    useGenerationKeys: false,
    useGenerationCleanup: false,
  },
  versioned: {
    mode: 'versioned',
    useReadEntitySelectors: false,
    useWriteEntitySelectors: false,
    useGenerationKeys: true,
    useGenerationCleanup: true,
  },
};

function resolveConfiguredStrategyMode(mode: CacheStrategyMode | undefined): CacheStrategyMode {
  if (mode === undefined) {
    return 'targeted';
  }
  return mode;
}

function resolveConfiguredStrategyDefinition(mode: CacheStrategyMode): CacheStrategyDefinition {
  return CACHE_STRATEGY_DEFINITIONS[mode];
}

const CACHE_INTERNAL_INDEX_PREFIX = '__prisma_next_cache:index:';

/**
 * Default `maxEntries` for the built-in in-memory store. Bounded so a
 * runaway producer cannot exhaust process memory; users who need
 * different bounds supply a custom `CacheStore`.
 */
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Reads the cache payload from the plan, if present and branded.
 *
 * Returns `undefined` when:
 * - the plan has no `meta.annotations`, or
 * - the `cache` namespace key is absent, or
 * - the value under `cache` is not a branded `AnnotationValue` (the
 *   `cacheAnnotation.read` defensive check covers this).
 */
function readCachePayload(plan: ExecutionPlan): CachePayload | undefined {
  return cacheAnnotation.read(plan);
}

function readUncachePayload(plan: ExecutionPlan) {
  return uncacheAnnotation.read(plan);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? blindCast<Record<string, unknown>, 'type guard verified: value is object & non-null'>(value)
    : undefined;
}

function getAst(exec: ExecutionPlan): Record<string, unknown> | undefined {
  return asRecord(
    blindCast<
      Record<string, unknown>,
      'ExecutionPlan internally carries an ast field accessed during model detection'
    >(exec)['ast'],
  );
}

function collectTablesFromSource(source: unknown, out: Set<string>): void {
  const src = asRecord(source);
  if (src === undefined) {
    return;
  }
  if (src['kind'] === 'table-source') {
    const name = src['name'];
    if (typeof name === 'string' && name.length > 0) {
      out.add(name);
    }
    return;
  }
  if (src['kind'] === 'derived-table-source') {
    collectModelsFromAst(src['query'], out);
  }
}

function collectModelsFromAst(astValue: unknown, out: Set<string>): void {
  const ast = asRecord(astValue);
  if (ast === undefined) {
    return;
  }

  const kind = ast['kind'];
  if (kind === 'insert' || kind === 'update' || kind === 'delete') {
    const table = asRecord(ast['table']);
    const tableName = table?.['name'];
    if (typeof tableName === 'string' && tableName.length > 0) {
      out.add(tableName);
    }
    return;
  }

  if (kind === 'select') {
    collectTablesFromSource(ast['from'], out);
    const joins = ast['joins'];
    if (Array.isArray(joins)) {
      for (const joinValue of joins) {
        const join = asRecord(joinValue);
        if (join !== undefined) {
          collectTablesFromSource(join['source'], out);
        }
      }
    }
    return;
  }
}

function detectModels(exec: ExecutionPlan): readonly string[] {
  const out = new Set<string>();
  collectModelsFromAst(getAst(exec), out);
  return [...out];
}

function readTableName(ast: Record<string, unknown>): string | undefined {
  const table = asRecord(ast['table']);
  const name = table?.['name'];
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function asEntityValue(value: unknown): string | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return undefined;
}

function collectEqualityConditions(whereValue: unknown, out: Map<string, string>): void {
  const where = asRecord(whereValue);
  if (where === undefined) {
    return;
  }

  if (where['kind'] === 'binary' && where['op'] === 'eq') {
    const left = asRecord(where['left']);
    const right = asRecord(where['right']);
    if (left?.['kind'] === 'column-ref' && right?.['kind'] === 'literal') {
      const column = left['column'];
      const value = asEntityValue(right['value']);
      if (typeof column === 'string' && column.length > 0 && value !== undefined) {
        out.set(column, value);
      }
      return;
    }
    if (right?.['kind'] === 'column-ref' && left?.['kind'] === 'literal') {
      const column = right['column'];
      const value = asEntityValue(left['value']);
      if (typeof column === 'string' && column.length > 0 && value !== undefined) {
        out.set(column, value);
      }
      return;
    }
    return;
  }

  if (where['kind'] === 'and') {
    const exprs = where['exprs'];
    if (!Array.isArray(exprs)) {
      return;
    }
    for (const expr of exprs) {
      collectEqualityConditions(expr, out);
    }
  }
}

function resolveContractRecord(contract: unknown): Record<string, unknown> | undefined {
  return asRecord(contract);
}

function resolveStorageTableRecord(
  contract: unknown,
  tableName: string,
): Record<string, unknown> | undefined {
  const contractRecord = resolveContractRecord(contract);
  const storage = asRecord(contractRecord?.['storage']);
  if (storage === undefined) {
    return undefined;
  }

  const directTables = asRecord(storage['tables']);
  if (directTables !== undefined) {
    const table = asRecord(directTables[tableName]);
    if (table !== undefined) {
      return table;
    }
  }

  const namespaces = asRecord(storage['namespaces']);
  if (namespaces === undefined) {
    return undefined;
  }

  for (const namespace of Object.values(namespaces)) {
    const namespaceRecord = asRecord(namespace);
    const tables = asRecord(namespaceRecord?.['tables']);
    if (tables === undefined) {
      continue;
    }
    const table = asRecord(tables[tableName]);
    if (table !== undefined) {
      return table;
    }
  }

  return undefined;
}

function resolveModelNameForTable(contract: unknown, tableName: string): string | undefined {
  const contractRecord = resolveContractRecord(contract);
  const domain = asRecord(contractRecord?.['domain']);
  const namespaces = asRecord(domain?.['namespaces']);
  if (namespaces === undefined) {
    return undefined;
  }

  for (const namespace of Object.values(namespaces)) {
    const namespaceRecord = asRecord(namespace);
    const models = asRecord(namespaceRecord?.['models']);
    if (models === undefined) {
      continue;
    }
    for (const [modelName, modelValue] of Object.entries(models)) {
      const model = asRecord(modelValue);
      const storage = asRecord(model?.['storage']);
      if (storage?.['table'] === tableName) {
        return modelName;
      }
    }
  }

  return undefined;
}

function resolvePrimaryKeyColumnsForTable(contract: unknown, tableName: string): readonly string[] {
  const table = resolveStorageTableRecord(contract, tableName);
  const primaryKey = asRecord(table?.['primaryKey']);
  const columns = primaryKey?.['columns'];
  if (!Array.isArray(columns)) {
    return [];
  }
  return columns.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function readEntitySelectorFromWhere(
  contract: unknown,
  tableName: string,
  whereValue: unknown,
): EntitySelector | undefined {
  const primaryKeyColumns = resolvePrimaryKeyColumnsForTable(contract, tableName);
  const selectorColumns = primaryKeyColumns.length > 0 ? primaryKeyColumns : ['id'];
  const conditions = new Map<string, string>();
  collectEqualityConditions(whereValue, conditions);

  for (const column of selectorColumns) {
    if (!conditions.has(column)) {
      return undefined;
    }
  }

  const model = resolveModelNameForTable(contract, tableName) ?? tableName;
  const key = selectorColumns
    .map((column) => `${column}=${JSON.stringify(conditions.get(column))}`)
    .join('|');

  return {
    model,
    tableName,
    id: key,
    columns: selectorColumns,
  };
}

function detectReadEntitySelectors(
  exec: ExecutionPlan,
  ctx: RuntimeMiddlewareContext,
  models: readonly string[],
): readonly EntitySelector[] {
  const ast = getAst(exec);
  if (ast?.['kind'] !== 'select' || models.length !== 1) {
    return [];
  }
  const from = asRecord(ast['from']);
  if (from?.['kind'] !== 'table-source') {
    return [];
  }
  const tableName = from['name'];
  if (tableName === undefined) {
    return [];
  }
  if (typeof tableName !== 'string' || tableName.length === 0) {
    return [];
  }
  const selector = readEntitySelectorFromWhere(ctx.contract, tableName, ast['where']);
  if (selector === undefined) {
    return [];
  }
  return [selector];
}

function detectWriteEntitySelectors(
  exec: ExecutionPlan,
  ctx: RuntimeMiddlewareContext,
): readonly EntitySelector[] {
  const ast = getAst(exec);
  if (ast === undefined) {
    return [];
  }

  const kind = ast['kind'];
  if (kind !== 'update' && kind !== 'delete') {
    return [];
  }

  const model = readTableName(ast);
  if (model === undefined) {
    return [];
  }

  const selector = readEntitySelectorFromWhere(ctx.contract, model, ast['where']);
  if (selector === undefined) {
    return [];
  }

  return [selector];
}

function isReadExecution(exec: ExecutionPlan): boolean {
  const ast = getAst(exec);
  if (ast?.['kind'] === 'select') {
    return true;
  }
  return readCachePayload(exec) !== undefined;
}

function isWriteExecution(exec: ExecutionPlan): boolean {
  const ast = getAst(exec);
  const kind = ast?.['kind'];
  if (kind === 'insert' || kind === 'update' || kind === 'delete') {
    return true;
  }
  return readUncachePayload(exec) !== undefined;
}

function applyNamespace(key: string, namespace: string | undefined): string {
  return namespace === undefined ? key : `${namespace}:${key}`;
}

function uniqSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function createInflightMiss(): InflightMiss {
  let resolve!: (rows: readonly Record<string, unknown>[] | undefined) => void;
  const promise = new Promise<readonly Record<string, unknown>[] | undefined>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Computes the cache key for an execution.
 *
 * Two-tier resolution:
 *
 * 1. Per-query override: `cacheAnnotation({ key })` — the supplied
 *    string is used verbatim. Not rehashed; the user is responsible for
 *    keeping the string bounded and free of sensitive data.
 * 2. Default: `ctx.contentHash(exec)` — the family runtime owns this and
 *    returns an opaque, bounded digest (SHA-512 in the SQL and Mongo
 *    runtimes today).
 *
 * The returned string is consumed directly as the `Map<string, …>` key
 * by the underlying `CacheStore`; the cache middleware does not perform
 * any further transformation.
 */
async function resolveCacheKey(
  payload: CachePayload,
  exec: ExecutionPlan,
  ctx: RuntimeMiddlewareContext,
): Promise<string> {
  if (payload.key !== undefined) {
    return payload.key;
  }
  return ctx.contentHash(exec);
}

function resolveUncacheActions(
  exec: ExecutionPlan,
  uncacheOnMutation: boolean,
): readonly UncacheAction[] | undefined {
  const payload = readUncachePayload(exec);
  if (payload?.skip === true || payload?.enabled === false) {
    return undefined;
  }
  if (payload?.uncache !== undefined) {
    return payload.uncache;
  }
  if (payload?.enabled === true || uncacheOnMutation) {
    return [payload?.namespace !== undefined ? { namespace: payload.namespace } : {}];
  }
  return undefined;
}

function matchesNamespacePattern(namespace: string, pattern: string): boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(namespace);
    } catch {
      return false;
    }
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(namespace);
}

function lookupNamespaceConfig(
  namespace: string | undefined,
  patterns: Record<string, NamespaceConfig> | undefined,
): NamespaceConfig | undefined {
  if (namespace === undefined || patterns === undefined) return undefined;
  if (patterns[namespace] !== undefined) return patterns[namespace];
  const sorted = Object.keys(patterns)
    .filter((p) => p !== namespace)
    .sort((a, b) => b.length - a.length);
  for (const pattern of sorted) {
    if (matchesNamespacePattern(namespace, pattern)) return patterns[pattern];
  }
  return undefined;
}

function makeStoreHandle(name: string, store: CacheStore): StoreHandle {
  return {
    name,
    store,
    modelKeyIndex: new Map(),
    entityKeyIndex: new Map(),
    modelGenerations: new Map(),
    inflightMisses: new Map(),
  };
}

function generationKey(model: string): string {
  return `${CACHE_INTERNAL_GENERATION_PREFIX}${model}`;
}

function sharedModelIndexPrefix(model: string): string {
  return `${CACHE_INTERNAL_INDEX_PREFIX}model:${model}:`;
}

function sharedEntityIndexPrefix(selector: EntitySelector): string {
  return `${CACHE_INTERNAL_INDEX_PREFIX}entity:${selector.model}:${selector.id}:`;
}

function parseIndexedCacheKey(indexKey: string, prefix: string): string | undefined {
  if (!indexKey.startsWith(prefix)) {
    return undefined;
  }
  const cacheKey = indexKey.slice(prefix.length);
  return cacheKey.length > 0 ? cacheKey : undefined;
}

function isKeyInNamespace(key: string, namespace: string): boolean {
  if (key.startsWith(`${namespace}:`)) return true;
  // Index keys embed the cache key as a suffix after the model/entity prefix.
  // Check whether that embedded cache key belongs to the namespace.
  if (key.startsWith(CACHE_INTERNAL_INDEX_PREFIX)) {
    const afterPrefix = key.slice(CACHE_INTERNAL_INDEX_PREFIX.length);
    return afterPrefix.includes(`:${namespace}:`);
  }
  return false;
}

/**
 * Creates a family-agnostic caching middleware.
 *
 * The middleware uses three hooks:
 *
 * - `intercept` — on each execution, checks the cache. On a hit, returns
 *   the cached raw rows; the runtime skips `beforeExecute`, `runDriver`,
 *   and `onRow`, and yields the cached rows to the consumer (which, in
 *   the SQL runtime, sees them after the standard `decodeRow` pass —
 *   i.e. the cache stores wire-format values). On a miss, records a
 *   pending buffer keyed on the `exec` object identity and returns
 *   `undefined` (passthrough).
 * - `onRow` — on the miss path, appends each row yielded by the driver
 *   to the pending buffer.
 * - `afterExecute` — on the miss path, commits the buffer to the store
 *   if and only if `result.completed === true && result.source === 'driver'`.
 *   Failed executions and middleware-served executions never populate
 *   the cache. The pending buffer is cleared in all branches so a stale
 *   `WeakMap` entry cannot leak between executions sharing an `exec`.
 *
 * Read caching can be enabled either by `cacheAnnotation` on the plan
 * or globally via middleware options. `cacheAnnotation` payload fields
 * override global defaults per query. Mutation-triggered invalidation
 * can be enabled globally (`uncacheOnMutation`) or per mutation via
 * `uncacheAnnotation`.
 *
 * The middleware bypasses cache lookup when:
 * - effective caching is disabled,
 * - no effective TTL can be resolved, or
 * - `ctx.scope !== 'runtime'` (connection / transaction scopes opt out).
 *
 * Returns a cross-family `RuntimeMiddleware` (no `familyId` /
 * `targetId`). The package depends only on
 * `@prisma-next/framework-components/runtime`; cache keys come from
 * `ctx.contentHash(exec)`, populated by the family runtime, so SQL and
 * Mongo runtimes both work out of the box.
 *
 * @example
 * ```typescript
 * import { createCacheMiddleware, cacheAnnotation } from '@prisma-next/middleware-cache';
 *
 * const db = postgres({
 *   contractJson,
 *   url: process.env['DATABASE_URL']!,
 *   middleware: [createCacheMiddleware({ maxEntries: 1000 })],
 * });
 *
 * const user = await db.User.first(
 *   { id },
 *   (meta) => meta.annotate(cacheAnnotation({ ttl: 60_000 })),
 * );
 * ```
 */
export function createCacheMiddleware(options?: CacheMiddlewareOptions): CacheMiddleware {
  const defaultHandle = makeStoreHandle(
    '__default__',
    options?.store ??
      createInMemoryCacheStore({ maxEntries: options?.maxEntries ?? DEFAULT_MAX_ENTRIES }),
  );
  const namedHandles = new Map<string, StoreHandle>();
  if (options?.stores !== undefined) {
    for (const [name, s] of Object.entries(options.stores)) {
      namedHandles.set(name, makeStoreHandle(name, s));
    }
  }
  const clock = options?.clock ?? Date.now;

  function resolveStoreHandle(storeName: string | undefined): StoreHandle {
    if (storeName === undefined) return defaultHandle;
    return namedHandles.get(storeName) ?? defaultHandle;
  }

  function buildExecConfig(
    namespace: string | undefined,
    annotationStoreName: string | undefined,
  ): ResolvedExecConfig {
    const nsConfig = lookupNamespaceConfig(namespace, options?.namespaces);
    const effectiveStoreName = annotationStoreName ?? nsConfig?.store;
    const storeHandle = resolveStoreHandle(effectiveStoreName);
    const strategyMode = resolveConfiguredStrategyMode(
      nsConfig?.cacheStrategy?.mode ?? options?.cacheStrategy?.mode,
    );
    const strategy = resolveConfiguredStrategyDefinition(strategyMode);
    const hasDeleteAndList =
      storeHandle.store.del !== undefined && storeHandle.store.list !== undefined;
    const useAutomaticGenerationFallback = strategy.mode !== 'versioned' && !hasDeleteAndList;
    return {
      storeHandle,
      strategy,
      useGenerationKeys: strategy.useGenerationKeys || useAutomaticGenerationFallback,
      useGenerationCleanup: strategy.useGenerationCleanup || useAutomaticGenerationFallback,
      generationScope:
        nsConfig?.cacheStrategy?.generation?.scope ??
        options?.cacheStrategy?.generation?.scope ??
        'detected-models',
      generationBumpOn:
        nsConfig?.cacheStrategy?.generation?.bumpOn ??
        options?.cacheStrategy?.generation?.bumpOn ??
        'uncache',
      generationGuardEnabled:
        (nsConfig?.cacheStrategy?.generation?.guard?.enabled ??
          options?.cacheStrategy?.generation?.guard?.enabled) === true,
      generationGuardMaxDeletes:
        nsConfig?.cacheStrategy?.generation?.guard?.maxDeletesPerBump ??
        options?.cacheStrategy?.generation?.guard?.maxDeletesPerBump ??
        500,
      storeOperationMode: nsConfig?.storeOperationMode ?? options?.storeOperationMode ?? 'await',
      readCaching: nsConfig?.readCaching ?? options?.readCaching ?? false,
      readDedupe: nsConfig?.readDedupe ?? options?.readDedupe ?? false,
      defaultTtlMs: nsConfig?.defaultTtlMs ?? options?.defaultTtlMs,
      uncacheOnMutation: nsConfig?.uncacheOnMutation ?? options?.uncacheOnMutation ?? false,
    };
  }

  const pending = new WeakMap<object, PendingMiss>();

  function entityTag(selector: EntitySelector): string {
    return `${selector.model}:${selector.id}`;
  }

  async function getModelGeneration(h: StoreHandle, model: string): Promise<number> {
    if (h.store.incr !== undefined) {
      return h.store.incr(generationKey(model), 0);
    }
    return h.modelGenerations.get(model) ?? 0;
  }

  async function bumpModelGeneration(h: StoreHandle, model: string): Promise<number> {
    if (h.store.incr !== undefined) {
      return h.store.incr(generationKey(model));
    }
    const next = (h.modelGenerations.get(model) ?? 0) + 1;
    h.modelGenerations.set(model, next);
    return next;
  }

  async function withGenerationKey(
    h: StoreHandle,
    useGenerationKeys: boolean,
    baseKey: string,
    models: readonly string[],
  ): Promise<string> {
    if (!useGenerationKeys || models.length === 0) return baseKey;
    const token = await Promise.all(
      uniqSorted(models).map(async (model) => `${model}@${await getModelGeneration(h, model)}`),
    );
    return `${baseKey}|g:${token.join(',')}`;
  }

  async function bumpGenerationForModels(
    h: StoreHandle,
    models: readonly string[],
  ): Promise<number[]> {
    const versions: number[] = [];
    for (const model of uniqSorted(models)) {
      versions.push(await bumpModelGeneration(h, model));
    }
    return versions;
  }

  async function collectIndexedCacheKeysForModel(
    h: StoreHandle,
    model: string,
  ): Promise<Set<string>> {
    const keysToDelete = new Set<string>(h.modelKeyIndex.get(model) ?? []);
    if (h.store.list === undefined) return keysToDelete;
    const prefix = sharedModelIndexPrefix(model);
    const indexedKeys = await h.store.list(prefix);
    for (const indexKey of indexedKeys) {
      keysToDelete.add(indexKey);
      const cacheKey = parseIndexedCacheKey(indexKey, prefix);
      if (cacheKey !== undefined) keysToDelete.add(cacheKey);
    }
    return keysToDelete;
  }

  async function collectIndexedCacheKeysForEntity(
    h: StoreHandle,
    selector: EntitySelector,
  ): Promise<Set<string>> {
    const keysToDelete = new Set<string>(h.entityKeyIndex.get(entityTag(selector)) ?? []);
    if (h.store.list === undefined) return keysToDelete;
    const prefix = sharedEntityIndexPrefix(selector);
    const indexedKeys = await h.store.list(prefix);
    for (const indexKey of indexedKeys) {
      keysToDelete.add(indexKey);
      const cacheKey = parseIndexedCacheKey(indexKey, prefix);
      if (cacheKey !== undefined) keysToDelete.add(cacheKey);
    }
    return keysToDelete;
  }

  function removeKeyFromIndex(h: StoreHandle, key: string): void {
    for (const [model, keys] of h.modelKeyIndex) {
      keys.delete(key);
      if (keys.size === 0) h.modelKeyIndex.delete(model);
    }
    for (const [tag, keys] of h.entityKeyIndex) {
      keys.delete(key);
      if (keys.size === 0) h.entityKeyIndex.delete(tag);
    }
  }

  async function cleanupStaleGenerationKeys(
    h: StoreHandle,
    config: ResolvedExecConfig,
    models: readonly string[],
  ): Promise<number> {
    if (!config.generationGuardEnabled || !config.useGenerationCleanup) return 0;
    if (h.store.del === undefined) return 0;
    let remaining = config.generationGuardMaxDeletes;
    if (remaining <= 0) return 0;
    let deleted = 0;
    for (const model of uniqSorted(models)) {
      const keys = await collectIndexedCacheKeysForModel(h, model);
      if (keys.size === 0) continue;
      for (const key of keys) {
        if (remaining <= 0) return deleted;
        await h.store.del(key);
        removeKeyFromIndex(h, key);
        remaining--;
        deleted++;
      }
    }
    return deleted;
  }

  async function bumpGenerationAndCleanup(
    h: StoreHandle,
    config: ResolvedExecConfig,
    models: readonly string[],
  ): Promise<GenerationBumpResult | undefined> {
    const uniqueModels = uniqSorted(models);
    if (uniqueModels.length === 0) return undefined;
    await bumpGenerationForModels(h, uniqueModels);
    const deletedKeys = await cleanupStaleGenerationKeys(h, config, uniqueModels);
    return { models: uniqueModels, deletedKeys };
  }

  function resolveGenerationModelsForWrite(
    config: ResolvedExecConfig,
    detectedModels: readonly string[],
    actions: readonly UncacheAction[] | undefined,
  ): readonly string[] {
    if (config.generationScope === 'action-models-preferred') {
      const fromActions: string[] = [];
      if (actions !== undefined) {
        for (const action of actions) {
          if (action.models !== undefined) fromActions.push(...action.models);
        }
      }
      if (fromActions.length > 0) return uniqSorted(fromActions);
    }
    return uniqSorted(detectedModels);
  }

  async function indexKeyForModels(
    h: StoreHandle,
    key: string,
    models: readonly string[],
    ttlMs: number,
  ): Promise<void> {
    for (const model of models) {
      if (!h.modelKeyIndex.has(model)) h.modelKeyIndex.set(model, new Set<string>());
      h.modelKeyIndex.get(model)!.add(key);
      await h.store.set(
        `${sharedModelIndexPrefix(model)}${key}`,
        { rows: [], storedAt: clock() },
        ttlMs,
      );
    }
  }

  async function indexKeyForEntities(
    h: StoreHandle,
    key: string,
    selectors: readonly EntitySelector[],
    ttlMs: number,
  ): Promise<void> {
    for (const selector of selectors) {
      const tag = entityTag(selector);
      if (!h.entityKeyIndex.has(tag)) h.entityKeyIndex.set(tag, new Set<string>());
      h.entityKeyIndex.get(tag)!.add(key);
      await h.store.set(
        `${sharedEntityIndexPrefix(selector)}${key}`,
        { rows: [], storedAt: clock() },
        ttlMs,
      );
    }
  }

  async function invalidateForEntitySelectors(
    h: StoreHandle,
    config: ResolvedExecConfig,
    selectors: readonly EntitySelector[],
    namespace: string | undefined,
    allowGenerationBump = true,
  ): Promise<GenerationBumpResult | undefined> {
    if (config.useGenerationCleanup && allowGenerationBump && selectors.length > 0) {
      return bumpGenerationAndCleanup(
        h,
        config,
        selectors.map((s) => s.model),
      );
    }
    if (h.store.del === undefined) {
      throw new Error(
        'cache middleware: the configured CacheStore does not implement `del`. ' +
          'Implement `del` (and `list`) on your store to enable uncache/invalidation.',
      );
    }
    const keysToDelete = new Set<string>();
    for (const selector of selectors) {
      for (const key of await collectIndexedCacheKeysForEntity(h, selector)) {
        keysToDelete.add(key);
      }
    }
    for (const key of keysToDelete) {
      if (namespace !== undefined && !isKeyInNamespace(key, namespace)) continue;
      await h.store.del(key);
      removeKeyFromIndex(h, key);
    }
    return undefined;
  }

  async function invalidateForModels(
    h: StoreHandle,
    config: ResolvedExecConfig,
    models: readonly string[],
    namespace: string | undefined,
    allowGenerationBump = true,
  ): Promise<GenerationBumpResult | undefined> {
    if (config.useGenerationCleanup && allowGenerationBump && models.length > 0) {
      return bumpGenerationAndCleanup(h, config, models);
    }
    if (h.store.del === undefined) {
      throw new Error(
        'cache middleware: the configured CacheStore does not implement `del`. ' +
          'Implement `del` (and `list`) on your store to enable uncache/invalidation.',
      );
    }
    const keysToDelete = new Set<string>();
    for (const model of models) {
      for (const key of await collectIndexedCacheKeysForModel(h, model)) {
        keysToDelete.add(key);
      }
    }
    if (keysToDelete.size === 0 && models.length === 0) {
      if (h.store.list === undefined) {
        throw new Error(
          'cache middleware: the configured CacheStore does not implement `list`. ' +
            'Implement `list` (and `del`) on your store to enable uncache/invalidation.',
        );
      }
      const all = await h.store.list(namespace === undefined ? undefined : `${namespace}:`);
      for (const key of all) keysToDelete.add(key);
    }
    for (const key of keysToDelete) {
      if (namespace !== undefined && !isKeyInNamespace(key, namespace)) continue;
      await h.store.del(key);
      removeKeyFromIndex(h, key);
    }
    return undefined;
  }

  async function invalidateForAction(
    h: StoreHandle,
    config: ResolvedExecConfig,
    action: UncacheAction,
    models: readonly string[] = [],
    entitySelectors: readonly EntitySelector[] = [],
    allowGenerationBump = true,
  ): Promise<GenerationBumpResult | undefined> {
    let generationBump: GenerationBumpResult | undefined;

    if (action.models !== undefined && action.models.length > 0) {
      generationBump = await invalidateForModels(
        h,
        config,
        action.models,
        action.namespace,
        allowGenerationBump,
      );
    }

    if (action.keys !== undefined && action.keys.length > 0) {
      if (h.store.del === undefined) {
        throw new Error(
          'cache middleware: the configured CacheStore does not implement `del`. ' +
            'Implement `del` (and `list`) on your store to enable uncache/invalidation.',
        );
      }
      for (const key of action.keys) {
        const resolvedKey = applyNamespace(key, action.namespace);
        await h.store.del(resolvedKey);
        removeKeyFromIndex(h, resolvedKey);
      }
    } else if (action.tags !== undefined && action.tags.length > 0) {
      if (h.store.delByTag === undefined) {
        throw new Error(
          'cache middleware: the configured CacheStore does not implement `delByTag`. ' +
            'Implement `delByTag` on your store to enable tag-based cache invalidation.',
        );
      }
      await h.store.delByTag(action.tags);
    } else if (action.models === undefined || action.models.length === 0) {
      if (entitySelectors.length > 0) {
        generationBump = await invalidateForEntitySelectors(
          h,
          config,
          entitySelectors,
          action.namespace,
          allowGenerationBump,
        );
      } else {
        generationBump = await invalidateForModels(
          h,
          config,
          models,
          action.namespace,
          allowGenerationBump,
        );
      }
    }

    return generationBump;
  }

  async function runStoreTask(
    task: () => Promise<void>,
    ctx: RuntimeMiddlewareContext,
    event: string,
    storeOperationMode: CacheStoreOperationMode,
  ): Promise<void> {
    if (storeOperationMode === 'detached') {
      void task().catch((error) => {
        ctx.log.warn?.({
          event,
          middleware: 'cache',
          mode: 'detached',
          error,
        });
      });
      return;
    }
    await task();
  }

  async function intercept(
    exec: ExecutionPlan,
    ctx: RuntimeMiddlewareContext,
  ): Promise<{ readonly rows: Iterable<Record<string, unknown>> } | undefined> {
    if (ctx.scope !== 'runtime') return undefined;

    const payload = readCachePayload(exec);
    const namespace = payload?.namespace ?? options?.namespace;
    const execConfig = buildExecConfig(namespace, payload?.store);

    const hasAnnotation = payload !== undefined;
    if (!hasAnnotation && !execConfig.readCaching) return undefined;
    if (!isReadExecution(exec)) return undefined;
    if (payload?.skip === true || payload?.enabled === false) return undefined;

    const ttlMs = payload?.ttl ?? execConfig.defaultTtlMs;
    if (ttlMs === undefined) return undefined;

    const dedupeEnabled = payload?.dedupe ?? execConfig.readDedupe;
    const resolvedKey = await resolveCacheKey(payload ?? {}, exec, ctx);
    const tags = payload?.tags;
    const models = detectModels(exec);
    const entitySelectors = execConfig.strategy.useReadEntitySelectors
      ? detectReadEntitySelectors(exec, ctx, models)
      : [];
    const baseKey = applyNamespace(resolvedKey, namespace);
    const h = execConfig.storeHandle;
    const effectiveKey = await withGenerationKey(h, execConfig.useGenerationKeys, baseKey, models);
    const hit = await h.store.get(effectiveKey);
    if (hit !== undefined) {
      ctx.log.debug?.({ event: 'middleware.cache.hit', middleware: 'cache', key: effectiveKey });
      return { rows: hit.rows };
    }

    if (dedupeEnabled) {
      const inflight = h.inflightMisses.get(effectiveKey);
      if (inflight !== undefined) {
        ctx.log.debug?.({
          event: 'middleware.cache.dedupe.wait',
          middleware: 'cache',
          key: effectiveKey,
        });
        const rows = await inflight.promise;
        if (rows !== undefined) {
          ctx.log.debug?.({
            event: 'middleware.cache.dedupe.hit',
            middleware: 'cache',
            key: effectiveKey,
          });
          return { rows };
        }
        return undefined;
      }
      h.inflightMisses.set(effectiveKey, createInflightMiss());
    }

    pending.set(exec, {
      key: effectiveKey,
      ttlMs,
      models,
      entitySelectors,
      tags,
      buffer: [],
      resolvedConfig: execConfig,
    });
    ctx.log.debug?.({ event: 'middleware.cache.miss', middleware: 'cache', key: effectiveKey });
    return undefined;
  }

  async function onRow(
    row: Record<string, unknown>,
    exec: ExecutionPlan,
    _ctx: RuntimeMiddlewareContext,
  ): Promise<void> {
    const slot = pending.get(exec);
    if (slot === undefined) return;
    slot.buffer.push(row);
  }

  async function afterExecute(
    exec: ExecutionPlan,
    result: AfterExecuteResult,
    ctx: RuntimeMiddlewareContext,
  ): Promise<void> {
    const logGenerationTelemetry = (bump: GenerationBumpResult | undefined): void => {
      if (bump === undefined) return;
      ctx.log.debug?.({
        event: 'middleware.cache.generation.bump',
        middleware: 'cache',
        models: bump.models,
        deletedKeys: bump.deletedKeys,
      });
      if (bump.deletedKeys > 0) {
        ctx.log.debug?.({
          event: 'middleware.cache.generation.guard.cleanup',
          middleware: 'cache',
          models: bump.models,
          deletedKeys: bump.deletedKeys,
        });
      }
    };

    const successfulDriverExecution = result.completed && result.source === 'driver';
    const slot = pending.get(exec);

    if (slot !== undefined) {
      pending.delete(exec);
      const { resolvedConfig } = slot;
      const h = resolvedConfig.storeHandle;
      const inflight = h.inflightMisses.get(slot.key);

      try {
        if (successfulDriverExecution) {
          const commitTask = async () => {
            await h.store.set(
              slot.key,
              { rows: slot.buffer, storedAt: clock(), tags: slot.tags },
              slot.ttlMs,
            );
            await indexKeyForModels(h, slot.key, slot.models, slot.ttlMs);
            if (resolvedConfig.strategy.useWriteEntitySelectors) {
              await indexKeyForEntities(h, slot.key, slot.entitySelectors, slot.ttlMs);
            }
          };
          await runStoreTask(
            commitTask,
            ctx,
            'middleware.cache.store.detached.error',
            resolvedConfig.storeOperationMode,
          );
          inflight?.resolve(slot.buffer);
          ctx.log.debug?.({ event: 'middleware.cache.store', middleware: 'cache', key: slot.key });
        } else {
          inflight?.resolve(undefined);
        }
      } catch (error) {
        inflight?.resolve(undefined);
        throw error;
      } finally {
        h.inflightMisses.delete(slot.key);
      }
    }

    if (!successfulDriverExecution || !isWriteExecution(exec)) return;

    const uncachePayload = readUncachePayload(exec);
    const writeNamespace = uncachePayload?.namespace ?? options?.namespace;
    const writeExecConfig = buildExecConfig(writeNamespace, undefined);

    const actions = resolveUncacheActions(exec, writeExecConfig.uncacheOnMutation);
    const detectedModels = detectModels(exec);

    const runWriteInvalidation = async () => {
      let generationBumpedForWrite = false;
      if (
        writeExecConfig.useGenerationCleanup &&
        writeExecConfig.generationBumpOn === 'all-writes'
      ) {
        const bump = await bumpGenerationAndCleanup(
          writeExecConfig.storeHandle,
          writeExecConfig,
          resolveGenerationModelsForWrite(writeExecConfig, detectedModels, actions),
        );
        logGenerationTelemetry(bump);
        generationBumpedForWrite = true;
      }

      if (actions === undefined) return;

      const detectedEntitySelectors = writeExecConfig.strategy.useWriteEntitySelectors
        ? detectWriteEntitySelectors(exec, ctx)
        : [];
      for (const action of actions) {
        const actionConfig = buildExecConfig(action.namespace ?? writeNamespace, undefined);
        const bump = await invalidateForAction(
          actionConfig.storeHandle,
          actionConfig,
          action,
          detectedModels,
          detectedEntitySelectors,
          !generationBumpedForWrite,
        );
        logGenerationTelemetry(bump);
      }
      ctx.log.debug?.({ event: 'middleware.cache.uncache', middleware: 'cache' });
    };

    await runStoreTask(
      runWriteInvalidation,
      ctx,
      'middleware.cache.uncache.detached.error',
      writeExecConfig.storeOperationMode,
    );
  }

  async function uncacheImpl(actions: readonly UncacheAction[]): Promise<void> {
    for (const action of actions) {
      const execConfig = buildExecConfig(action.namespace, undefined);
      await invalidateForAction(execConfig.storeHandle, execConfig, action);
    }
  }

  return {
    name: 'cache',
    intercept,
    onRow,
    afterExecute,
    uncache: uncacheImpl,
  };
}

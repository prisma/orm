import type { CrossFamilyMiddleware } from '@internal/framework-components/runtime';
import { cacheAnnotation, createCacheMiddleware } from '@internal/middleware-cache';
import { sql } from '@internal/sql-builder/runtime';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { useMiddlewareCacheDatabase } from './middleware-cache-database';

/*
 * Integration tests for `@internal/middleware-cache` against real
 * Postgres. The tests assert these behaviours end-to-end against
 * `createDevDatabase`:
 *
 * - Stop condition: a repeated annotated query is served from cache
 *   and never reaches the driver.
 * - Composition with a `beforeCompile`-style rewriter (soft-delete):
 *   the rewritten SQL contributes to the cache key.
 * - Composition with an inline observer middleware: the `source` field
 *   on `activityEnded` round-trips driver vs middleware fetches.
 * - Concurrency: two parallel calls of the same plan don't cross-talk
 *   through the per-statement buffer in `ctx.state`.
 *
 * Invalidation is covered in `middleware-cache-invalidation.test.ts`.
 */

/**
 * A `beforeCompile` middleware that injects a predicate filtering out
 * rows where `users.invited_by_id IS NULL` — used as a stand-in for a
 * "soft delete" rewriter to exercise composition with the cache. The
 * cache key reflects the rewritten SQL because the cache middleware
 * sees the post-lowering plan.
 */
function activeUsersOnly(): SqlMiddleware {
  return {
    name: 'active-users-only',
    familyId: 'sql',
    async beforeCompile(draft) {
      if (draft.ast.kind !== 'select') return undefined;
      if (draft.ast.from?.kind !== 'table-source') return undefined;
      if (draft.ast.from.name !== 'users') return undefined;
      const invitedByPresent = BinaryExpr.gte(ColumnRef.of('users', 'id'), LiteralExpr.of(2));
      const newAst: SelectAst = draft.ast.withWhere(
        draft.ast.where ? AndExpr.of([draft.ast.where, invitedByPresent]) : invitedByPresent,
      );
      return { ...draft, ast: newAst };
    },
  };
}

describe('integration: middleware-cache against real Postgres', {
  timeout: timeouts.databaseOperation,
}, () => {
  const database = useMiddlewareCacheDatabase();
  const { buildRuntime } = database;

  describe('stop condition', () => {
    it('serves a repeated annotated read from cache without hitting the driver', async () => {
      const cache = createCacheMiddleware();
      const runtime = buildRuntime([cache]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      const buildPlan = () =>
        db.public.users.select('id', 'name').annotate(cacheAnnotation({})).build();

      database.driverQuerySpy.mockClear();

      // First call — cache miss; driver invoked.
      const first = await runtime.query(buildPlan()).toArray();
      const driverCallsAfterFirst = database.driverQuerySpy.mock.calls.length;
      expect(driverCallsAfterFirst).toBeGreaterThan(0);

      // Second call — cache hit; driver not invoked again.
      const second = await runtime.query(buildPlan()).toArray();
      expect(database.driverQuerySpy.mock.calls.length).toBe(driverCallsAfterFirst);

      // Both calls produce equivalent decoded rows.
      expect(second).toEqual(first);
      // Sanity — the table has 4 users so we got real data back.
      expect(first.length).toBe(4);
    });

    it('still hits the driver for an un-annotated query (cache is opt-in)', async () => {
      const cache = createCacheMiddleware();
      const runtime = buildRuntime([cache]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      database.driverQuerySpy.mockClear();

      await runtime.query(db.public.users.select('id').build()).toArray();
      const callsAfterFirst = database.driverQuerySpy.mock.calls.length;

      await runtime.query(db.public.users.select('id').build()).toArray();
      // Second un-annotated call hits the driver again.
      expect(database.driverQuerySpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });

    it('does not cache a query when its cacheAnnotation has bypass: true', async () => {
      const cache = createCacheMiddleware();
      const runtime = buildRuntime([cache]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      const buildPlan = () =>
        db.public.users
          .select('id')
          .annotate(cacheAnnotation({ bypass: true }))
          .build();

      database.driverQuerySpy.mockClear();

      await runtime.query(buildPlan()).toArray();
      const callsAfterFirst = database.driverQuerySpy.mock.calls.length;

      await runtime.query(buildPlan()).toArray();
      // Both calls hit the driver — bypass: true skips the cache.
      expect(database.driverQuerySpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
  });

  describe('composition with beforeCompile rewriter', () => {
    it('cache key reflects the rewritten SQL; rewritten predicate is preserved on the hit path', async () => {
      // Order: rewriter first, then cache. The cache sees the
      // post-lowering exec, so the rewritten predicate is part of
      // the cache key by construction.
      const rewriter = activeUsersOnly();
      const cache = createCacheMiddleware();
      const runtime = buildRuntime([rewriter, cache]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      const buildPlan = () =>
        db.public.users.select('id', 'name').annotate(cacheAnnotation({})).build();

      database.driverQuerySpy.mockClear();

      // First call: rewriter prepends `id >= 2`, driver executes.
      const first = await runtime.query(buildPlan()).toArray();
      const callsAfterFirst = database.driverQuerySpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);

      // The rewriter's `id >= 2` predicate filtered out user 1
      // (Alice), so the cached results don't include her.
      expect(first.map((r) => r['id']).sort()).toEqual([2, 3, 4]);

      // Second call: cache hit, driver skipped, but the consumer
      // still sees the rewritten (filtered) result set.
      const second = await runtime.query(buildPlan()).toArray();
      expect(database.driverQuerySpy.mock.calls.length).toBe(callsAfterFirst);
      expect(second).toEqual(first);
      expect(second.map((r) => r['id']).sort()).toEqual([2, 3, 4]);
    });

    it('cache key for the same query differs when registered with vs. without the rewriter', async () => {
      // Two runtimes share the same custom CacheStore so we can
      // observe whether the rewriter changes the key.
      const { createInMemoryCacheStore } = await import('@internal/middleware-cache');
      const sharedStore = createInMemoryCacheStore();

      const cacheNoRewrite = createCacheMiddleware({ store: sharedStore });
      const runtimeNoRewrite = buildRuntime([cacheNoRewrite]);

      const cacheWithRewrite = createCacheMiddleware({ store: sharedStore });
      const runtimeWithRewrite = buildRuntime([activeUsersOnly(), cacheWithRewrite]);

      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });
      const buildPlan = () => db.public.users.select('id').annotate(cacheAnnotation({})).build();

      database.driverQuerySpy.mockClear();

      // First runtime (no rewriter) populates the cache under one key.
      const noRewrite = await runtimeNoRewrite.query(buildPlan()).toArray();
      const callsAfterNoRewrite = database.driverQuerySpy.mock.calls.length;
      expect(noRewrite.map((r) => r['id']).sort()).toEqual([1, 2, 3, 4]);

      // Second runtime (with rewriter) sees a *different* lowered SQL
      // and therefore a different contentHash — it must miss and
      // hit the driver again.
      const withRewrite = await runtimeWithRewrite.query(buildPlan()).toArray();
      expect(database.driverQuerySpy.mock.calls.length).toBeGreaterThan(callsAfterNoRewrite);
      expect(withRewrite.map((r) => r['id']).sort()).toEqual([2, 3, 4]);
    });
  });

  describe('composition with an observer middleware', () => {
    /**
     * Inline cross-family observer. Captures the `phase`, `source`,
     * `rowCount`, and `latencyMs` fields off the framework SPI — the
     * same shape the (now-retired) `@internal/middleware-telemetry`
     * proof-of-concept exposed. These tests are really about
     * composition with the cache, not about telemetry, so an inline
     * observer reads more clearly than depending on a separate
     * package.
     */
    interface ObservedEvent {
      readonly phase: 'beforeEncode' | 'activityEnded';
      readonly source?: 'driver' | 'middleware';
      readonly rowCount?: number;
      readonly latencyMs?: number;
      readonly outcome?: string;
    }

    function createObserver(events: ObservedEvent[]): CrossFamilyMiddleware {
      return {
        name: 'observer',
        async beforeEncode() {
          events.push({ phase: 'beforeEncode' });
        },
        async activityEnded(_activity, result) {
          if (result.kind !== 'statement' || result.returns !== 'rows') return;
          events.push({
            phase: 'activityEnded',
            source: result.source,
            rowCount: result.rowCount,
            latencyMs: result.latencyMs,
            outcome: result.outcome,
          });
        },
      };
    }

    it('observer sees source: "driver" on miss and source: "middleware" on hit', async () => {
      const events: ObservedEvent[] = [];
      const observer = createObserver(events);
      const cache = createCacheMiddleware();
      // Cache first so its `intercept.onQuery` runs upstream of the observer in
      // the intercept chain. The observer's `activityEnded` still fires on
      // both paths and observes the `source` field, which is the
      // canonical hit-vs-miss signal.
      const runtime = buildRuntime([cache, observer]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      const buildPlan = () => db.public.users.select('id').annotate(cacheAnnotation({})).build();

      database.driverQuerySpy.mockClear();
      events.length = 0;

      // Miss path.
      await runtime.query(buildPlan()).toArray();

      const missEvents = events.slice();
      // `beforeEncode` fires on every statement, before the intercept
      // chain, so middleware that mutates ParamRef values stays visible
      // to encode regardless of whether a downstream interceptor wins.
      // The `source` field on `activityEnded` is what distinguishes
      // driver vs middleware paths.
      expect(missEvents.find((e) => e.phase === 'beforeEncode')).toBeDefined();
      const missAfter = missEvents.find((e) => e.phase === 'activityEnded');
      expect(missAfter).toBeDefined();
      expect(missAfter!.source).toBe('driver');
      expect(missAfter!.rowCount).toBe(4);

      events.length = 0;
      database.driverQuerySpy.mockClear();

      // Hit path.
      await runtime.query(buildPlan()).toArray();

      // `beforeEncode` still fires on the intercepted hit path — it runs
      // unconditionally before the intercept chain. The canonical hit
      // signal is `activityEnded` with `source === 'middleware'`, paired
      // with the driver not being invoked.
      expect(events.find((e) => e.phase === 'beforeEncode')).toBeDefined();
      const hitAfter = events.find((e) => e.phase === 'activityEnded');
      expect(hitAfter).toBeDefined();
      expect(hitAfter!.source).toBe('middleware');
      expect(hitAfter!.rowCount).toBe(4);
      expect(database.driverQuerySpy.mock.calls.length).toBe(0);
    });

    it('observer rowCount and latencyMs populate correctly on both paths', async () => {
      const events: ObservedEvent[] = [];
      const observer = createObserver(events);
      const cache = createCacheMiddleware();
      const runtime = buildRuntime([cache, observer]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      const buildPlan = () =>
        db.public.users.select('id', 'name').annotate(cacheAnnotation({})).build();

      // Miss → commit.
      await runtime.query(buildPlan()).toArray();
      // Hit.
      events.length = 0;
      await runtime.query(buildPlan()).toArray();

      const after = events.find((e) => e.phase === 'activityEnded');
      expect(after).toBeDefined();
      expect(after!.rowCount).toBe(4);
      expect(typeof after!.latencyMs).toBe('number');
      expect(after!.outcome).toBe('succeeded');
    });
  });

  describe('concurrency regression', () => {
    it('two parallel queries of the same plan do not cross-talk via their per-statement buffers', async () => {
      const cache = createCacheMiddleware();
      const runtime = buildRuntime([cache]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      const buildPlan = () =>
        db.public.users
          .select('id', 'name')
          .annotate(cacheAnnotation({ key: 'concurrency-test' }))
          .build();

      database.driverQuerySpy.mockClear();

      // Two parallel executions of the same logical plan. Each is its
      // own statement activity with its own `ctx.state`, where the cache
      // middleware keeps its miss buffer — so the two calls' buffers
      // must not interfere.
      const [a, b] = await Promise.all([
        runtime.query(buildPlan()).toArray(),
        runtime.query(buildPlan()).toArray(),
      ]);

      // Both calls produce correct, identical results.
      expect(a).toEqual(b);
      expect(a.length).toBe(4);

      // After both finish, the cache holds a single entry (one of
      // the misses commits last; same key, same data).
      const third = await runtime.query(buildPlan()).toArray();
      expect(third).toEqual(a);
    });

    it('parallel queries of two different plans land in distinct cache slots', async () => {
      const cache = createCacheMiddleware();
      const runtime = buildRuntime([cache]);
      const db = sql({
        context: database.context,
        rawCodecInferer: { inferCodec: () => 'pg/text' },
      });

      database.driverQuerySpy.mockClear();

      const planA = db.public.users
        .select('id')
        .annotate(cacheAnnotation({ key: 'parallel-A' }))
        .build();
      const planB = db.public.posts
        .select('id', 'title')
        .annotate(cacheAnnotation({ key: 'parallel-B' }))
        .build();

      const [a, b] = await Promise.all([
        runtime.query(planA).toArray(),
        runtime.query(planB).toArray(),
      ]);

      expect(a.every((r) => 'id' in r && !('title' in r))).toBe(true);
      expect(b.every((r) => 'id' in r && 'title' in r)).toBe(true);

      // The next call to each lands on the cache (driver count
      // unchanged after these reads).
      const callsAfterParallel = database.driverQuerySpy.mock.calls.length;
      await runtime
        .query(
          db.public.users
            .select('id')
            .annotate(cacheAnnotation({ key: 'parallel-A' }))
            .build(),
        )
        .toArray();
      await runtime
        .query(
          db.public.posts
            .select('id', 'title')
            .annotate(cacheAnnotation({ key: 'parallel-B' }))
            .build(),
        )
        .toArray();
      expect(database.driverQuerySpy.mock.calls.length).toBe(callsAfterParallel);
    });
  });
});

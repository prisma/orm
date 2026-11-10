import { cacheAnnotation, createCacheMiddleware } from '@internal/middleware-cache';
import { sql } from '@internal/sql-builder/runtime';
import type { Runtime } from '@internal/sql-runtime';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { useMiddlewareCacheDatabase } from './middleware-cache-database';

/*
 * Integration tests for `invalidate` on `@internal/middleware-cache` against real Postgres:
 * invalidating by key makes the next read see a write that happened after the rows were cached.
 */

describe('integration: middleware-cache invalidation against real Postgres', {
  timeout: timeouts.databaseOperation,
}, () => {
  const database = useMiddlewareCacheDatabase();
  const { buildRuntime } = database;

  function readUserOneName(runtime: Runtime) {
    const db = sql({ context: database.context, rawCodecInferer: { inferCodec: () => 'pg/text' } });
    return runtime
      .query(
        db.public.users
          .select('name')
          .where((f, fns) => fns.eq(f.id, 1))
          .annotate(cacheAnnotation({ key: 'user-1', meta: { tags: ['users'] } }))
          .build(),
      )
      .toArray();
  }

  it('a read after invalidate({ keys }) sees the committed write', async () => {
    const cache = createCacheMiddleware();
    const runtime = buildRuntime([cache]);

    try {
      expect(await readUserOneName(runtime)).toEqual([{ name: 'Alice' }]);

      await database.client.query(`UPDATE users SET name = 'Alicia' WHERE id = 1`);
      database.driverQuerySpy.mockClear();

      expect(await readUserOneName(runtime)).toEqual([{ name: 'Alice' }]);
      expect(database.driverQuerySpy).not.toHaveBeenCalled();

      await cache.invalidate({ keys: ['user-1'] });

      expect(await readUserOneName(runtime)).toEqual([{ name: 'Alicia' }]);
      expect(database.driverQuerySpy).toHaveBeenCalledTimes(1);
    } finally {
      await database.client.query(`UPDATE users SET name = 'Alice' WHERE id = 1`);
    }
  });

  it('invalidate({ meta }) rejects against the default store, which does not index meta', async () => {
    const cache = createCacheMiddleware();
    const runtime = buildRuntime([cache]);
    await readUserOneName(runtime);

    await expect(cache.invalidate({ meta: { tags: ['users'] } })).rejects.toMatchObject({
      code: 'RUNTIME.CACHE_STORE_META_UNSUPPORTED',
    });
  });
});

// This worker reads Temporal-backed temporal columns, and workerd ships no global `Temporal`.
// Installed here rather than in a test setup so the deployed worker has it too.
// `full/global` rather than `global`: the default build omits non-ISO calendars and its published
// types resolve to `export {}`.
import 'temporal-polyfill/full/global';

import { withTransaction } from '@prisma/orm-postgres/family-runtime';
import { Client } from 'pg';
import { createOrmClient } from './orm-client/client';
import { db } from './prisma/db';

interface Env {
  HYPERDRIVE: { connectionString: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });

    if (url.pathname === '/sql/users') {
      const limit = parseLimit(url.searchParams.get('limit'), 10);
      const rows = await runtime.query(
        db.sql.public.user
          .select('id', 'email', 'displayName', 'kind', 'createdAt')
          .limit(limit)
          .build(),
      );
      return Response.json({ ok: true, route: 'sql/users', count: rows.length, rows });
    }

    if (url.pathname === '/orm/users') {
      const limit = parseLimit(url.searchParams.get('limit'), 10);
      const orm = createOrmClient(runtime);
      const rows = await orm.User.newestFirst().take(limit).all();
      return Response.json({ ok: true, route: 'orm/users', count: rows.length, rows });
    }

    if (url.pathname === '/orm/posts') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        return Response.json({ ok: false, error: 'userId required' }, { status: 400 });
      }
      const limit = parseLimit(url.searchParams.get('limit'), 10);
      const orm = createOrmClient(runtime);
      const rows = await orm.Post.where({ userId })
        .orderBy((post) => post.createdAt.desc())
        .take(limit)
        .all();
      return Response.json({ ok: true, route: 'orm/posts', count: rows.length, rows });
    }

    if (url.pathname === '/tx/commit') {
      const userId = url.searchParams.get('userId');
      const newDisplayName = url.searchParams.get('displayName') ?? 'Updated';
      if (!userId) {
        return Response.json({ ok: false, error: 'userId required' }, { status: 400 });
      }
      const result = await withTransaction(runtime, async (tx) => {
        await tx.execute(
          db.sql.public.post
            .insert([
              {
                title: `Post written in tx for ${userId}`,
                userId,
                createdAt: Temporal.Now.instant(),
              },
            ])
            .build(),
        );
        await tx.execute(
          db.sql.public.user
            .update({ displayName: newDisplayName })
            .where((f, fns) => fns.eq(f.id, userId))
            .build(),
        );
        return { committed: true };
      });
      return Response.json({ ok: true, route: 'tx/commit', ...result });
    }

    if (url.pathname === '/tx/rollback') {
      try {
        await withTransaction(runtime, async (tx) => {
          await tx.execute(
            db.sql.public.user
              .update({ displayName: 'rolled-back-write' })
              .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
              .build(),
          );
          throw new Error('intentional rollback');
        });
        return Response.json({ ok: false, error: 'expected rollback but transaction committed' });
      } catch (err) {
        return Response.json({
          ok: true,
          route: 'tx/rollback',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (url.pathname === '/cursor/large') {
      const breakAfter = parseLimit(url.searchParams.get('break'), 50);
      const consumed: { id: string; title: string }[] = [];
      let cancelled = false;

      // Open a side-channel pg.Client to instrument the cursor query via
      // pg_stat_statements (loaded via shared_preload_libraries in
      // docker-compose / CI). Two-client pattern: the runtime owns the
      // primary connection that runs the SELECT; this observer connection
      // resets stats before and reads them after, so the test can prove
      // that with cursor enabled the server transmitted only ~one batch
      // worth of rows (not the full LIMIT). With cursor disabled the
      // observer would see the full ~10_000 rows row count.
      const observer = new Client({ connectionString: env.HYPERDRIVE.connectionString });
      // A dropped connection emits 'error' on the client; without a listener
      // that is an uncaught exception and kills the isolate mid-response.
      observer.on('error', () => {});
      await observer.connect();
      try {
        await observer.query('SELECT pg_stat_statements_reset()');

        const t0 = Date.now();
        // SELECT bounded to the post-table budget cap (10_000 — see
        // `src/prisma/db.ts`). With cursor enabled the driver opens a
        // server-side cursor and streams in ~100-row batches; an early
        // `break` only fetches one batch and closes. With cursor disabled
        // the driver buffers all 10_000 rows before the first yield.
        const iter = runtime.query(
          db.sql.public.post
            .select('id', 'title')
            .orderBy((f) => f.createdAt, { direction: 'asc' })
            .limit(10_000)
            .build(),
        );
        for await (const row of iter) {
          consumed.push(row);
          if (consumed.length >= breakAfter) {
            cancelled = true;
            break;
          }
        }
        const elapsedMs = Date.now() - t0;

        // Sum rows over every statement that touched the post table since
        // the reset above. pg_stat_statements normalizes parameters but
        // preserves table names, so the LIKE filter is precise enough.
        const statsResult = await observer.query<{ rows: string }>(
          `SELECT COALESCE(SUM(rows), 0)::text AS rows
           FROM pg_stat_statements
           WHERE query ILIKE '%from%post%'`,
        );
        const rowsTransmitted = Number(statsResult.rows[0]?.rows ?? '0');

        return Response.json({
          ok: true,
          route: 'cursor/large',
          consumed: consumed.length,
          cancelled,
          elapsedMs,
          rowsTransmitted,
        });
      } finally {
        await observer.end();
      }
    }

    // The Task collection (and its Bug/Feature variants) is wired in
    // `src/orm-client/collections.ts` for parity with the demo schema, but
    // queries against it currently fail with `column "bug.id" does not exist`
    // — class-table inheritance with @@map is broken at the ORM layer. Not
    // exercised here; flagged as pre-existing drift in M3 R2.

    return Response.json(
      { ok: false, error: 'unknown route', path: url.pathname },
      { status: 404 },
    );
  },
};

function parseLimit(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

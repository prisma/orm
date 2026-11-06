/**
 * service_role reaches the Supabase-internal namespaces (`auth`, `storage`)
 * through a separate secondary root: `db.asServiceRole().supabase`. The internal
 * contract is never merged into the app contract, so the primary root
 * (`asServiceRole().sql` / `.orm`) stays app-only, identical to `asAnon` /
 * `asUser`.
 *
 * Assertions:
 *
 *   1. `db.asServiceRole().supabase.sql.auth.users.select(…)` returns a seeded
 *      row and the emitted SQL targets `"auth"."users"`; the bound connection
 *      runs as `service_role` (read via `current_setting('role')`), proving it
 *      is the role grants — not the pool owner — that authorise the read. The
 *      ORM path (`.supabase.orm.auth.AuthUser.first(…)`) reads back the same row.
 *   2. The primary root `asServiceRole().sql.public.profile` still works
 *      (the secondary root does not disturb the app contract).
 *
 * The compile-time side (`.supabase` carries `auth`/`storage`; the primary root
 * and `asAnon`/`asUser` do not) lives in `service-role-namespaces.test-d.ts`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import type { SqlMiddleware } from '@internal/sql-runtime';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabasePack from '../src/exports/pack';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };
import { createDb } from './fixtures/example-app/db';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const TEST_INVOCATION = { cwd: process.cwd(), configPath: undefined, dbGiven: false };

function recordingMiddleware(): { middleware: SqlMiddleware; sqls: string[] } {
  const sqls: string[] = [];
  const middleware: SqlMiddleware = {
    name: 'sql-recorder',
    familyId: 'sql',
    async beforeEncode(plan) {
      sqls.push(plan.sql);
    },
  };
  return { middleware, sqls };
}

async function runDbInit(connectionString: string, migrationsDir: string): Promise<void> {
  const space = supabasePack.contractSpace;
  if (!space) throw new Error('supabasePack must declare a contractSpace');

  await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
    contract: space.contractJson,
    contractDts: '// supabase extension contract space\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });

  const client = createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [supabasePack],
  });

  try {
    await client.connect(connectionString);
    const result = await client.dbInit({
      invocation: TEST_INVOCATION,
      contract: contractJson,
      mode: 'apply',
      migrationsDir,
    });
    if (!result.ok) throw new Error(`dbInit apply failed: ${result.failure.message}`);
  } finally {
    await client.close();
  }
}

describe('service_role queries auth/storage via the .supabase secondary root', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-sliced-migrations-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'asServiceRole().supabase reads auth.users (sql + orm) as service_role; emitted SQL targets auth.users',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await setUpSupabaseMockSchema(pg);
        // The documented narrow grant for admin reads of auth.users through
        // the `.supabase` secondary root — real Supabase (and the shim)
        // gives service_role no table privileges on auth.* by default.
        await pg.query('GRANT USAGE ON SCHEMA auth TO service_role');
        await pg.query('GRANT SELECT ON TABLE auth.users TO service_role');
      });
      await runDbInit(connectionString, migrationsDir);

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'GRANT USAGE ON SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO anon, authenticated, service_role',
        );
      });

      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
          [userId, 'admin@example.com', now],
        );
      });

      const recorder = recordingMiddleware();
      const db = await createDb(connectionString, { middleware: [recorder.middleware] });

      try {
        const internal = db.asServiceRole().supabase;

        // SQL path: read auth.users via the secondary root.
        const rows = await internal
          .query(
            internal.sql.auth.users
              .select('id', 'email')
              .where((f, fns) => fns.eq(f.id, userId))
              .build(),
          )
          .toArray();

        expect(rows).toEqual([{ id: userId, email: 'admin@example.com' }]);

        // The emitted SQL must reference "auth"."users"
        const authQuery = recorder.sqls.find((s) => s.includes('"auth"') && s.includes('"users"'));
        expect(
          authQuery,
          `Expected a SQL query targeting "auth"."users"; saw: ${JSON.stringify(recorder.sqls)}`,
        ).toBeDefined();

        // Pin the bound role: the connection serving the secondary root must run
        // as service_role, not as the pool's owner/superuser (which would also
        // have had grants and passed the read above). This is the security boundary.
        const [boundRole] = await internal
          .query(
            internal.sql.auth.users
              .select('role', (_f, fns) => fns.raw`current_setting('role')`.returns('pg/text@1'))
              .where((f, fns) => fns.eq(f.id, userId))
              .build(),
          )
          .toArray();
        expect(boundRole).toEqual({ role: 'service_role' });

        // ORM path reaches auth through the secondary root: orm.auth.AuthUser maps
        // to "auth"."users". Reads back the same seeded row as the .sql assertion.
        const authUser = await internal.orm.auth.AuthUser.select('id', 'email').first({
          id: userId,
        });
        expect(authUser).toEqual({ id: userId, email: 'admin@example.com' });
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'asServiceRole() primary root stays app-only while .supabase reaches auth',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await setUpSupabaseMockSchema(pg);
        // The documented narrow grant for admin reads of auth.users through
        // the `.supabase` secondary root — real Supabase (and the shim)
        // gives service_role no table privileges on auth.* by default.
        await pg.query('GRANT USAGE ON SCHEMA auth TO service_role');
        await pg.query('GRANT SELECT ON TABLE auth.users TO service_role');
      });
      await runDbInit(connectionString, migrationsDir);

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'GRANT USAGE ON SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
        );
        await pg.query(
          'GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO anon, authenticated, service_role',
        );
      });

      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
          [userId, 'admin@example.com', now],
        );
      });

      const db = await createDb(connectionString);

      try {
        const sr = db.asServiceRole();

        // Primary root: the app contract, exactly as asUser/asAnon see it.
        await sr.query(sr.sql.public.profile.select('id').build()).toArray();

        // Secondary root: the Supabase-internal contract, reached only here.
        const authRows = await sr.supabase
          .query(sr.supabase.sql.auth.users.select('email').build())
          .toArray();

        expect(authRows.some((r) => r.email === 'admin@example.com')).toBe(true);
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});
// Type-level assertions for the surface (only .supabase carries auth/storage;
// the primary root and asAnon/asUser do not, and have no .supabase) live in
// service-role-namespaces.test-d.ts, typed with this example's app contract.

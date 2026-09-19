/**
 * Native Postgres enum end-to-end proof — the Supabase extension declares a
 * `native_enum AalLevel` in `auth` (member set `aal1`/`aal2`/`aal3`, mapped to
 * the Postgres type `aal_level`) and a `sessions` table with an `aal
 * pg.enum(AalLevel)?` column. Both are external — Prisma 8 emits no DDL
 * for them; `setUpSupabaseMockSchema` seeds `CREATE TYPE auth.aal_level` and
 * `auth.sessions` directly, mirroring the existing `auth.users`/`storage.*`
 * seed pattern.
 *
 * Proven here (native Postgres enums — Supabase demonstration):
 *
 *   1. A plain SELECT of `auth.sessions.aal` returns the seeded value and
 *      types as the value union `'aal1' | 'aal2' | 'aal3' | null` — read off
 *      the emitted `SupabaseExtensionContract` (the extension's own emitted
 *      `contract.d.ts`, reached through `.supabase`, the only surface that
 *      carries `auth.*`), not a hand-built type.
 *   2. `db.asServiceRole().supabase.nativeEnums.auth.AalLevel` exposes the
 *      same member set at runtime, wired via `@internal/postgres`'s
 *      `buildNamespacedNativeEnums`, built from the extension contract's own
 *      storage.
 *   3. A query that binds `aal` as a parameter forces the renderer to emit a
 *      `$N::auth.aal_level` cast (the column's own schema-qualified
 *      `nativeType`, since `auth` is not the default `public` schema). The
 *      query executes against real Postgres and returns the expected row.
 */

import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SupabaseInternalDb } from '../src/exports/runtime';
import { createDb } from './fixtures/example-app/db';
import { findSessionsByAal, readSessionAal } from './fixtures/example-app/session-queries';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const sessionId = '30000000-0000-0000-0000-000000000001';
const userId = '30000000-0000-0000-0000-000000000002';

async function seedSession(
  connectionString: string,
  aal: 'aal1' | 'aal2' | 'aal3' | null,
): Promise<void> {
  await withClient(connectionString, async (pg) => {
    const now = new Date().toISOString();
    await pg.query(
      'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
      [userId, 'session-owner@example.com', now],
    );
    await pg.query(
      'INSERT INTO auth.sessions (id, user_id, aal, created_at) VALUES ($1, $2, $3, $4)',
      [sessionId, userId, aal, now],
    );
  });
}

describe('native Postgres enum (auth.aal_level) on auth.sessions', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;

  it(
    'reads auth.sessions.aal as the value union, sourced from the emitted extension contract',
    async () => {
      database = await createDevDatabase();
      const { connectionString } = database;

      try {
        await withClient(connectionString, async (pg) => {
          await setUpSupabaseMockSchema(pg);
          // Narrow admin-read grant (mirrors real Supabase, where service_role
          // has no table privileges on auth.* by default).
          await pg.query('GRANT USAGE ON SCHEMA auth TO service_role');
          await pg.query('GRANT SELECT ON TABLE auth.sessions TO service_role');
        });
        await seedSession(connectionString, 'aal2');

        const db = await createDb(connectionString);
        try {
          const internal: SupabaseInternalDb = db.asServiceRole().supabase;

          const row = await readSessionAal(internal, sessionId);
          expect(row).toEqual({ id: sessionId, aal: 'aal2' });

          // The field's type comes from the emitted SupabaseExtensionContract
          // (packages/3-extensions/supabase/src/contract/contract.d.ts) via
          // the `.supabase` secondary root — `auth.sessions` is reachable
          // only through this root (see explicit-namespace-query.integration.test.ts),
          // so this is the emitted contract that types `auth.*`. A widening
          // to `string` fails this assertion.
          expectTypeOf(row?.aal).toEqualTypeOf<'aal1' | 'aal2' | 'aal3' | null | undefined>();
        } finally {
          await db.close();
        }
      } finally {
        await database.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'db.nativeEnums.auth.AalLevel exposes the same member set at runtime',
    async () => {
      database = await createDevDatabase();
      const { connectionString } = database;

      try {
        await withClient(connectionString, async (pg) => {
          await setUpSupabaseMockSchema(pg);
          // Narrow admin-read grant (mirrors real Supabase, where service_role
          // has no table privileges on auth.* by default).
          await pg.query('GRANT USAGE ON SCHEMA auth TO service_role');
          await pg.query('GRANT SELECT ON TABLE auth.sessions TO service_role');
        });

        const db = await createDb(connectionString);
        try {
          const internal: SupabaseInternalDb = db.asServiceRole().supabase;
          const AalLevel = internal.nativeEnums.auth['AalLevel'];

          expect(AalLevel?.values).toEqual(['aal1', 'aal2', 'aal3']);
          expect(AalLevel?.members['aal2']).toBe('aal2');

          // Literal-typing proof: the accessor's values are typed from the
          // emitted contract's native_enum entries, not a generic string[].
          expectTypeOf(internal.nativeEnums.auth.AalLevel.values).toEqualTypeOf<
            readonly ['aal1', 'aal2', 'aal3']
          >();

          // `Value` derives the same value union via plain `typeof`, with the
          // accessor already in scope (no separate type import needed).
          expectTypeOf<typeof internal.nativeEnums.auth.AalLevel.Value>().toEqualTypeOf<
            'aal1' | 'aal2' | 'aal3'
          >();
        } finally {
          await db.close();
        }
      } finally {
        await database.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'filtering auth.sessions where aal = $1 binds a $N::auth.aal_level cast that executes',
    async () => {
      database = await createDevDatabase();
      const { connectionString } = database;

      try {
        await withClient(connectionString, async (pg) => {
          await setUpSupabaseMockSchema(pg);
          // Narrow admin-read grant (mirrors real Supabase, where service_role
          // has no table privileges on auth.* by default).
          await pg.query('GRANT USAGE ON SCHEMA auth TO service_role');
          await pg.query('GRANT SELECT ON TABLE auth.sessions TO service_role');
        });
        await seedSession(connectionString, 'aal2');

        const db = await createDb(connectionString);
        try {
          const internal: SupabaseInternalDb = db.asServiceRole().supabase;

          // Before the schema-qualification fix, this failed with:
          //   SqlQueryError: type "aal_level" does not exist
          //   (Postgres code 42704, routine typenameType)
          // because the unqualified cast resolved under the default
          // search_path (`public`), and `aal_level` lives in `auth`. The
          // column's `nativeType` is now schema-qualified (`auth.aal_level`),
          // so the cast resolves and the query executes.
          const rows = await findSessionsByAal(internal, 'aal2');
          expect(rows).toEqual([{ id: sessionId, aal: 'aal2' }]);
        } finally {
          await db.close();
        }
      } finally {
        await database.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );
});

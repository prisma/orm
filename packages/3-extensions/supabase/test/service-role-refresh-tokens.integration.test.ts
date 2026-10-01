/**
 * Integration test — service_role reads `auth.refresh_tokens` through the
 * `.supabase` secondary root (see
 * ./explicit-namespace-query.integration.test.ts for
 * the `auth.users` coverage this mirrors). `refresh_tokens` comes from the
 * introspection-generated complete contract, so this extends that coverage
 * beyond the handful of originally hand-declared tables.
 *
 * Lives in the pack's own tree rather than the example app's: only a
 * minimal single-model app contract is needed to exercise the `.supabase`
 * secondary root, so the pack-side harness (this file, following
 * `reference-fixture-verify.integration.test.ts`'s `buildAppContract`
 * pattern) is preferable to a full example-app round trip.
 */

import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabasePack from '../src/exports/pack';
import supabase from '../src/runtime/supabase';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const pgUuid = { many: false, codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: false } as const;
const fixtureJwt = 'fixture-jwt-signing-input-not-a-real-credential';

function buildAppContract() {
  const Item = model('Item', {
    fields: {
      id: field.column(pgUuid).id(),
    },
  }).sql({ table: 'item' });

  return defineContract({
    extensions: { supabase: supabasePack },
    models: { Item },
  });
}

describe('service_role reads auth.refresh_tokens via the .supabase secondary root', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;

  beforeEach(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'reads a seeded row via .supabase.sql.auth.refresh_tokens and via the ORM accessor',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (pg) => {
        await setUpSupabaseMockSchema(pg);
        // The narrow grant a real project needs for admin reads through the
        // `.supabase` secondary root: real Supabase gives service_role no
        // table privileges on auth.* (the shim matches those defaults).
        await pg.query('GRANT USAGE ON SCHEMA auth TO service_role');
        await pg.query('GRANT SELECT ON TABLE auth.refresh_tokens TO service_role');
      });

      const token = `refresh-token-${crypto.randomUUID()}`;
      let tokenId = 0n;
      await withClient(connectionString, async (pg) => {
        // `refresh_tokens.id` is an int8, which `pg` returns as a decimal string.
        const result = await pg.query<{ id: string }>(
          'INSERT INTO auth.refresh_tokens (token, revoked) VALUES ($1, false) RETURNING id',
          [token],
        );
        const inserted = result.rows[0]?.id;
        if (inserted === undefined) {
          throw new Error('INSERT INTO auth.refresh_tokens returned no row for RETURNING id');
        }
        tokenId = BigInt(inserted);
      });

      const appContract = buildAppContract();
      const db = await supabase({
        contract: appContract,
        url: connectionString,
        jwtSecret: fixtureJwt,
      });

      try {
        const internal = db.asServiceRole().supabase;

        const rows = await internal
          .query(
            internal.sql.auth.refresh_tokens
              .select('token', 'revoked')
              .where((f, fns) => fns.eq(f.token, token))
              .build(),
          )
          .toArray();
        expect(rows).toEqual([{ token, revoked: false }]);

        const ormRow = await internal.orm.auth.RefreshTokens.select('token', 'revoked').first({
          id: tokenId,
        });
        expect(ormRow).toEqual({ token, revoked: false });
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );
});

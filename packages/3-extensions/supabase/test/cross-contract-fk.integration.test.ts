/**
 * Integration test — cross-contract FK from `public.profile.user_id → auth.users.id`
 * on a live PGlite database.
 *
 *   1. A synthetic app contract built in-test with the TS builder declares
 *      `Profile.userId → auth.users.id` (via `belongsTo(AuthUser, …)` +
 *      `constraints.foreignKey(cols.userId, AuthUser.refs.id, { onDelete: 'cascade' })`).
 *   2. The supabase extension space artifacts are materialised on disk so the
 *      aggregate loader can compose them.
 *   3. PGlite is seeded with the external `auth.*` / `storage.*` tables via
 *      `setUpSupabaseMockSchema`.
 *   4. The CLI's `dbInit` (apply mode) runs through the aggregate planner and
 *      emits `ALTER TABLE … ADD CONSTRAINT … REFERENCES "auth"."users"("id")`.
 *   5. `pg_constraint` is queried cross-joining `pg_namespace` + `pg_class` to
 *      confirm the cross-schema FK exists with the right target.
 *      - `confdeltype = 'c'` (cascade DDL declaration) is asserted.
 *      - The target column resolves to `id` on `auth.users`.
 *   6. `dbVerify` returns zero issues across both spaces.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthUser } from '../src/exports/contract';
import supabasePack from '../src/exports/pack';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

// ---------------------------------------------------------------------------
// Synthetic app contract — Profile model with cross-space FK to auth.users.id
// ---------------------------------------------------------------------------

const pgUuid = { codecId: 'pg/uuid@1', dataType: 'pg/uuid', nullable: false } as const;

/**
 * Build the app contract that exercises the cross-space FK path.
 *
 * Profile has:
 *   - `id: uuid @id`
 *   - `userId: uuid @unique` — the FK column referencing `auth.users.id`
 *   - `user: belongsTo(AuthUser, { from: 'userId', to: 'id' })`
 *   - `constraints.foreignKey(cols.userId, AuthUser.refs.id, { onDelete: 'cascade' })`
 *
 * The contract declares `extensions: { supabase: supabasePack }` so the
 * cross-space FK lowering can validate the space is composed.
 */
function buildAppContract() {
  const Profile = model('Profile', {
    fields: {
      id: field.column(pgUuid).id(),
      userId: field.column(pgUuid).unique(),
    },
    relations: {
      user: rel.belongsTo(AuthUser, { from: 'userId', to: 'id' }),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'profile',
    foreignKeys: [constraints.foreignKey(cols.userId, AuthUser.refs.id, { onDelete: 'cascade' })],
  }));

  return defineContract({
    extensions: { supabase: supabasePack },
    models: { Profile },
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AC7 — cross-contract FK: public.profile.user_id → auth.users.id', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'cross-contract-fk-migrations-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'cross-schema FK is in pg_constraint; confdeltype=c; dbVerify passes with zero issues',
    async () => {
      const { connectionString } = database;
      const appContract = buildAppContract();
      const serializer = new PostgresContractSerializer();
      const appContractJson = serializer.serializeContract(appContract);

      // Step 1 — Seed the external Supabase schemas + tables.
      //
      // The verifier's `external` policy requires declared tables to exist.
      // Without this, `db verify` would fail with `declaredMissing` for every
      // `auth.*` / `storage.*` table.
      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
      });

      // Step 2 — Materialise the supabase extension space artifacts on disk.
      //
      // The supabase pack ships zero migration packages — it declares only external
      // schema. We write `contract.json` + `refs/head.json` so the aggregate loader
      // discovers the space via its normal on-disk read path.
      const supabaseSpace = supabasePack.contractSpace;
      if (!supabaseSpace) {
        throw new Error('supabasePack must declare a contractSpace');
      }
      await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
        contract: supabaseSpace.contractJson,
        contractDts: '// supabase extension contract space\n',
        headRef: {
          hash: supabaseSpace.headRef.hash,
          invariants: [...supabaseSpace.headRef.invariants],
        },
      });

      // Step 3 — Materialise the app contract space artifacts on disk.
      //
      // `dbInit` reads the app's `refs/head.json` to determine whether the
      // schema has already been initialised. For a first-run test we write the
      // app space artifacts so the loader treats it as a fresh db-init.
      const appStorageHash = String(appContract.storage.storageHash);
      await emitContractSpaceArtifacts(migrationsDir, 'app', {
        contract: appContractJson,
        contractDts: '// synthetic app contract\n',
        headRef: { hash: appStorageHash, invariants: [] },
      });

      // Step 4 — Run `db init` (apply mode).
      //
      // This exercises the full aggregate planner pipeline — the planner
      // emits `REFERENCES "auth"."users"("id")` and the FK constraint is
      // created in the live DB.
      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [supabasePack],
      });

      try {
        await client.connect(connectionString);

        const applyResult = await client.dbInit({
          contract: appContractJson,
          mode: 'apply',
          migrationsDir,
        });

        if (!applyResult.ok) {
          throw new Error(
            `db init apply failed: ${applyResult.failure.summary}\n\n${JSON.stringify(applyResult.failure, null, 2)}`,
          );
        }

        // Step 5 — Query `pg_constraint` for the cross-schema FK.
        //
        // The SQL cross-joins pg_namespace and pg_class on both source and target
        // sides so the query works across schemas. A same-schema query using
        // `connamespace = 'public'::regnamespace` would miss the target schema.
        await withClient(connectionString, async (pgClient) => {
          const fkExistsResult = await pgClient.query<{ exists: boolean }>(`
            SELECT EXISTS (
              SELECT 1
              FROM pg_constraint c
              JOIN pg_class src ON c.conrelid = src.oid
              JOIN pg_namespace src_ns ON src.relnamespace = src_ns.oid
              JOIN pg_class tgt ON c.confrelid = tgt.oid
              JOIN pg_namespace tgt_ns ON tgt.relnamespace = tgt_ns.oid
              WHERE c.contype = 'f'
                AND src_ns.nspname = 'public'
                AND src.relname = 'profile'
                AND tgt_ns.nspname = 'auth'
                AND tgt.relname = 'users'
            ) AS exists
          `);
          expect(
            fkExistsResult.rows[0]?.exists,
            'Expected a FK constraint from public.profile to auth.users in pg_constraint',
          ).toBe(true);

          // Assert the target column is `id` on `auth.users` via pg_attribute.
          const targetColumnResult = await pgClient.query<{ col: string }>(`
            SELECT a.attname AS col
            FROM pg_constraint c
            JOIN pg_class src ON c.conrelid = src.oid
            JOIN pg_namespace src_ns ON src.relnamespace = src_ns.oid
            JOIN pg_class tgt ON c.confrelid = tgt.oid
            JOIN pg_namespace tgt_ns ON tgt.relnamespace = tgt_ns.oid
            JOIN pg_attribute a ON a.attrelid = tgt.oid AND a.attnum = ANY(c.confkey)
            WHERE c.contype = 'f'
              AND src_ns.nspname = 'public'
              AND src.relname = 'profile'
              AND tgt_ns.nspname = 'auth'
              AND tgt.relname = 'users'
          `);
          expect(
            targetColumnResult.rows.map((r) => r.col),
            'Expected FK target column to be "id" on auth.users',
          ).toEqual(['id']);

          // Assert confdeltype = 'c' (ON DELETE CASCADE was declared in DDL).
          const cascadeResult = await pgClient.query<{ confdeltype: string }>(`
            SELECT c.confdeltype
            FROM pg_constraint c
            JOIN pg_class src ON c.conrelid = src.oid
            JOIN pg_namespace src_ns ON src.relnamespace = src_ns.oid
            JOIN pg_class tgt ON c.confrelid = tgt.oid
            JOIN pg_namespace tgt_ns ON tgt.relnamespace = tgt_ns.oid
            WHERE c.contype = 'f'
              AND src_ns.nspname = 'public'
              AND src.relname = 'profile'
              AND tgt_ns.nspname = 'auth'
              AND tgt.relname = 'users'
          `);
          expect(
            cascadeResult.rows[0]?.confdeltype,
            'Expected confdeltype = "c" (ON DELETE CASCADE declared in DDL)',
          ).toBe('c');
        });

        // Step 6 — Run `db verify` and assert zero issues.
        //
        // With the shim in place, all `external` tables are present and the
        // verifier should return ok with zero schema issues.
        const deserializedContract = serializer.deserializeContract(appContractJson);
        const verifyResult = await client.dbVerify({
          contract: deserializedContract,
          migrationsDir,
          strict: false,
          skipSchema: false,
          skipMarker: false,
        });

        expect(
          verifyResult.ok,
          `db verify failed: ${JSON.stringify(!verifyResult.ok ? verifyResult.failure : null, null, 2)}`,
        ).toBe(true);

        if (verifyResult.ok) {
          for (const [spaceId, schemaResult] of verifyResult.value.schemaResults) {
            expect(
              schemaResult.ok,
              `Schema verification failed for space "${spaceId}": ${JSON.stringify(schemaResult, null, 2)}`,
            ).toBe(true);
          }
        }
      } finally {
        await client.close();
      }
    },
    // seed + materialise + dbInit (apply) + pg_constraint queries + dbVerify
    timeouts.spinUpPpgDev * 4,
  );
});

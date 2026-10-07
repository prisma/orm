/**
 * Classification e2e: Supabase-shaped DB — public managed, auth/storage external.
 *
 * Proves that when a composed contract uses `supabasePack`, the framework
 * correctly classifies storage elements:
 *
 *   - `public.profile` is an **app-managed** element: the migration planner
 *     emits a `CREATE TABLE` op for it and the verifier confirms it is owned
 *     by the app contract space.
 *   - `auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`
 *     are classified **external**: the planner emits zero DDL ops targeting
 *     those tables, and the verifier treats them as external-present (not
 *     app-owned) when they exist in the database.
 *
 * The test seeds a PGlite database with the external tables (mimicking the
 * state a real Supabase project starts in), then runs `db init` and `db
 * verify` via the control client and asserts the per-space plan operations
 * and per-space verify results.
 *
 * Seed strategy: the external table seed SQL lives in the reference fixture
 * (`./fixtures/supabase-reference/`, applied via `setUpSupabaseMockSchema`)
 * and is shared with the sibling integration tests (including the walking
 * skeleton in ./skeleton.integration.test.ts).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf, createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabasePack from '../src/exports/pack';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

/**
 * Minimal app contract: a single `public` schema with a `profile` table.
 * No `defaultControlPolicy` — all tables are managed (the default).
 */
function buildAppContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('supabase-classification-test-app'),
    storage: new SqlStorage({
      storageHash: coreHash('supabase-classification-test-app'),
      namespaces: {
        public: postgresCreateNamespace({
          id: 'public',
          entries: {
            table: {
              profile: {
                columns: {
                  id: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
                  username: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('supabase external-schema classification (db init + db verify)', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-classification-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'public.profile is app-managed (has plan op); auth.* and storage.* are external (zero ops; verify passes)',
    async () => {
      const { connectionString } = database;
      const appContract = buildAppContract();

      // 1. Seed the external Supabase tables.
      //
      // The verifier's `external` policy confirms declared tables exist.
      // Without this seed, `db verify` would fail with `declaredMissing`
      // for every auth.*/storage.* table.
      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
      });

      // 2. Materialise the supabase extension contract space on disk.
      //
      // The supabase pack is migration-less: it declares only external schema
      // (auth.* / storage.* are Supabase-managed tables). We emit the space
      // artifacts (contract.json, refs/head.json) so `db init` discovers the
      // extension space. No migration packages are written — the loader treats a
      // zero-package space as all-external and the planner falls through to synth
      // strategy (zero ops).
      const space = supabasePack.contractSpace;
      if (!space) throw new Error('supabasePack must carry a contractSpace');

      await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
        contract: space.contractJson,
        contractDts: '// supabase extension contract space\n',
        headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
      });

      // 3. db init — plan mode.
      //
      // Assert: public.profile gets a `createTable` op (managed),
      // and zero ops target auth.* or storage.* (external).
      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [supabasePack],
      });

      try {
        await client.connect(connectionString);

        const planResult = await client.dbInit({
          contract: appContract,
          mode: 'plan',
          migrationsDir,
        });

        if (!planResult.ok) {
          throw new Error(`db init plan failed: ${JSON.stringify(planResult.failure, null, 2)}`);
        }

        const allOps = planResult.value.plan.operations;
        const allOpIds = allOps.map((op) => op.id);

        // public.profile must be planned for creation.
        const hasProfileCreateOp = allOpIds.some(
          (id) => id.toLowerCase().includes('profile') || id.toLowerCase().includes('createtable'),
        );
        expect(
          hasProfileCreateOp,
          `Expected a createTable op for public.profile; ops: ${JSON.stringify(allOpIds)}`,
        ).toBe(true);

        // Zero ops must target auth or storage schemas.
        const authOrStorageOps = allOps.filter((op) => {
          const id = op.id.toLowerCase();
          const label = (op.label ?? '').toLowerCase();
          return (
            id.includes('auth.') ||
            id.includes('storage.') ||
            label.includes('auth.') ||
            label.includes('storage.')
          );
        });
        expect(
          authOrStorageOps,
          `Expected zero auth/storage ops; got: ${JSON.stringify(authOrStorageOps.map((o) => o.id))}`,
        ).toHaveLength(0);

        // Per-space breakdown: supabase space must carry zero ops.
        const perSpace = planResult.value.perSpace ?? [];
        const supabaseSpaceEntry = perSpace.find((e) => e.spaceId === 'supabase');
        expect(
          supabaseSpaceEntry,
          'Expected supabase space to appear in perSpace breakdown',
        ).toBeDefined();
        expect(
          supabaseSpaceEntry?.operations ?? [],
          'Expected supabase extension space to have zero plan ops (all tables are external)',
        ).toHaveLength(0);

        // 4. db init — apply mode.
        const applyResult = await client.dbInit({
          contract: appContract,
          mode: 'apply',
          migrationsDir,
        });
        if (!applyResult.ok) {
          throw new Error(`db init apply failed: ${JSON.stringify(applyResult.failure, null, 2)}`);
        }

        // 5. db verify.
        //
        // With the external shim in place, the verifier confirms all declared
        // `external` tables exist. The per-space result for `supabase` must
        // pass, and the per-space result for `app` must also pass.
        const deserializedContract = new PostgresContractSerializer().deserializeContract(
          appContract,
        );
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
          // Every space (app + supabase) must have a passing verify result.
          for (const [spaceId, schemaResult] of verifyResult.value.schemaResults) {
            expect(
              schemaResult.ok,
              `Schema verification failed for space "${spaceId}": ${JSON.stringify(schemaResult, null, 2)}`,
            ).toBe(true);
          }

          // The supabase space's verify result must reflect external-present
          // status: it passes, meaning auth.* / storage.* are confirmed present
          // and were not flagged as missing owned tables.
          const supabaseVerifyResult = verifyResult.value.schemaResults.get('supabase');
          expect(
            supabaseVerifyResult,
            'Expected a schema verify result for the supabase space',
          ).toBeDefined();
          expect(
            supabaseVerifyResult?.ok,
            `supabase space schema verification must pass when external tables are present; got: ${JSON.stringify(supabaseVerifyResult)}`,
          ).toBe(true);

          // The supabase space issues list must be empty: no DDL errors, no
          // missing tables, no column drift for the external tables.
          expect(
            supabaseVerifyResult?.schema.issues ?? [],
            `supabase space must have zero schema issues; got: ${JSON.stringify(supabaseVerifyResult?.schema.issues)}`,
          ).toHaveLength(0);
        }
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});

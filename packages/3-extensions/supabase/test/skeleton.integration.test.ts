/**
 * Walking skeleton integration test — external-contract migrate/verify + public round-trip.
 *
 * Proves the core claim of `@internal/extension-supabase`:
 *
 *   When a composed contract declares `extensions: [supabasePack]`, the
 *   framework treats the Supabase `auth.*` and `storage.*` tables as
 *   `external`. Concretely:
 *
 *   1. `db init` emits **zero ops** for `auth.*` / `storage.*` in the supabase
 *      extension space (those tables are never created by our migrations).
 *   2. The supabase extension space's plan covers only the `public.profile`
 *      DDL via the app space.
 *   3. `db verify` **passes** after `db init` because:
 *      - The `setUpSupabaseMockSchema` pre-seeded the external tables, so the
 *        verifier's `external` policy (`declaredMissing` → fail) is satisfied.
 *      - Extra columns / tables in the live DB are suppressed by `external`
 *        policy.
 *   4. The `auth.users` table is reachable via a raw pg client after `db init`.
 *
 * How the supabase extension space participates:
 *   The supabase pack declares `contractSpace` (contract + headRef, no migrations).
 *   The test materialises `migrations/supabase/` on disk (via
 *   `emitContractSpaceArtifacts`) so `db init` discovers the extension space and
 *   processes its `auth.*` / `storage.*` tables through the aggregate planner.
 *   Because the pack ships zero migration packages, the loader synthesizes the head
 *   ref from the contract hash and the planner falls through to synth strategy (zero
 *   ops); the verifier then confirms the declared external tables are present in the DB.
 *
 * Framework fix landed (2026-06-05):
 *   `executeRun` and `executeDbVerify` now pass a merged aggregate contract to
 *   `familyInstance.introspect` so the Postgres adapter walks every declared
 *   namespace (not just `public`). The full proof was confirmed green with this fix
 *   in place. See `feat(cli): introspect all declared namespaces for db init/verify`.
 *
 * Active in CI as of M1 (the external-contract + public.* proof is green); later
 * constituents extend the assertions in place.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import { coreHash, UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { PostgresRole, PostgresSchema } from '@internal/target-postgres/types';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabasePack from '../src/exports/pack';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };
import { createDb } from './fixtures/example-app/db';
import type { Contract as NoPolicyContract } from './fixtures/no-policy/contract';
import noPolicyContractJson from './fixtures/no-policy/contract.json' with { type: 'json' };
import type { Contract as RenamedPolicyContract } from './fixtures/renamed-policy/contract';
import renamedPolicyContractJson from './fixtures/renamed-policy/contract.json' with {
  type: 'json',
};
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

// Derive the policy wire name from the deserialized contract rather than pinning a literal.
// The public namespace holds exactly one policy; its `.name` is the content-addressed wire name.
const _deserializedForConsts = new PostgresContractSerializer().deserializeContract<Contract>(
  contractJson,
);
const _publicNsDeserialized = _deserializedForConsts.storage.namespaces['public'];
// _publicNs is a PostgresSchema at runtime after deserialization. isPostgresSchema narrows
// to PostgresSchema, but the intersection with the contract's structural literal type
// reduces to `never` in TypeScript because both define `kind` with incompatible literals
// ('schema' vs 'postgres-schema'). We cast through unknown to break the intersection.
const _publicNsAsSchema = _publicNsDeserialized as unknown as PostgresSchema;
const _allPolicies = Object.values(_publicNsAsSchema.policy);
// The base contract now carries three policies (authenticated SELECT-own,
// anon SELECT-all, authenticated UPDATE-own). `POLICY_WIRE_NAME` is the
// authenticated owner-read SELECT policy — the one tests B/D target.
const POLICY_WIRE_NAME: string =
  _allPolicies.find((p) => p.prefix === 'profile_owner_read')?.name ?? '';
const ALL_POLICY_WIRE_NAMES: readonly string[] = _allPolicies.map((p) => p.name);

// Active in CI (test:examples). This asserts the M1 walking-skeleton behaviour only —
// external-contract migrate/verify + the public.profile round-trip — which is green and
// stable. Later constituents (cross-contract-refs, postgres-rls, explicit-namespace-dsl)
// EXTEND this suite with their own assertions; they do not invalidate the M1 ones. The
// point of the skeleton is to be a continuous CI surface, so it runs rather than skips.
describe('supabase walking skeleton — external-contract migrate/verify + public round-trip', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-skeleton-migrations-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'db init emits no DDL for auth/storage; verifier passes; auth.users table reachable via raw pg',
    async () => {
      const { connectionString } = database;

      // Step 1 — Seed the external Supabase tables.
      //
      // Without this, `db verify` would fail with `declaredMissing` for every
      // `auth.*` / `storage.*` table — the verifier's `external` policy
      // confirms declared tables actually exist.
      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
      });

      // Step 2 — Materialise the supabase extension space on disk.
      //
      // `db init` discovers extension spaces by scanning `migrations/<space>/`.
      // The supabase pack is migration-less: it declares only external schema
      // (auth.* / storage.* are Supabase-managed tables) and ships zero DDL
      // migrations. We write the space artifacts (contract.json + refs/head.json)
      // so the aggregate loader picks the space up via the uniform read path —
      // head.json carries the pack's declared `{ hash, invariants }` on disk.
      // With no migration packages, the planner falls through to the synth
      // strategy (zero ops), and the integrity check skips `headRefNotInGraph`
      // because an empty graph has nothing to check the head ref against.
      const space = supabasePack.contractSpace;
      if (!space) {
        throw new Error('supabasePack must declare a contractSpace');
      }
      await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
        contract: space.contractJson,
        contractDts: '// supabase extension contract space\n',
        headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
      });

      // Step 3 — Run `db init` (plan mode first, then apply).
      //
      // The control client is configured with the same component set as the
      // example app. The app's contract.json covers only `public.profile`;
      // the supabase extension space (from `migrations/supabase/`) covers
      // `auth.*` and `storage.*` with `defaultControlPolicy: 'external'`.
      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [supabasePack],
      });

      try {
        await client.connect(connectionString);

        // --- Plan mode: verify zero ops for auth/storage ---

        const planResult = await client.dbInit({
          contract: contractJson,
          mode: 'plan',
          migrationsDir,
        });

        if (!planResult.ok) {
          throw new Error(
            `db init plan failed: ${planResult.failure.summary}\n\n${JSON.stringify(planResult.failure, null, 2)}`,
          );
        }

        const operations = planResult.value.plan.operations;

        // The plan must include `CREATE TABLE public.profile` (app space).
        const opIds = operations.map((op) => op.id);
        const hasProfileCreate = opIds.some(
          (id) => id.includes('profile') || id.includes('createTable'),
        );
        expect(
          hasProfileCreate,
          `Expected a createTable op for public.profile; got: ${JSON.stringify(opIds)}`,
        ).toBe(true);

        // The plan must include ENABLE RLS + CREATE POLICY for public.profile.
        const hasEnableRls = opIds.some((id) => id.startsWith('rowLevelSecurity.public.profile'));
        expect(
          hasEnableRls,
          `Expected ENABLE RLS op for public.profile; got: ${JSON.stringify(opIds)}`,
        ).toBe(true);
        const hasCreatePolicy = opIds.some((id) => id.startsWith('rlsPolicy.public.profile.'));
        expect(
          hasCreatePolicy,
          `Expected CREATE POLICY op for profile; got: ${JSON.stringify(opIds)}`,
        ).toBe(true);

        // The plan must emit ZERO ops targeting auth or storage schemas.
        const authOrStorageOps = operations.filter((op) => {
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
          `Expected zero auth/storage ops in plan; got: ${JSON.stringify(authOrStorageOps.map((o) => o.id))}`,
        ).toHaveLength(0);

        // --- Apply mode ---

        const applyResult = await client.dbInit({
          contract: contractJson,
          mode: 'apply',
          migrationsDir,
        });

        if (!applyResult.ok) {
          throw new Error(
            `db init apply failed: ${applyResult.failure.summary}\n\n${JSON.stringify(applyResult.failure, null, 2)}`,
          );
        }

        // Step 4 — Run `db verify`.
        //
        // With the shim in place the verifier confirms all declared `external`
        // tables exist. Without the shim this would fail with `declaredMissing`.
        const deserializedContract = new PostgresContractSerializer().deserializeContract<Contract>(
          contractJson,
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
          // All schema results for all spaces must pass.
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

      // Step 5 (bonus) — raw read from the seeded auth.users table.
      //
      // Proves the external table is reachable via a raw pg Client.
      await withClient(connectionString, async (client) => {
        const result = await client.query<{ table_name: string }>(
          `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = 'auth' AND table_name = 'users'`,
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.table_name).toBe('users');
      });
    },
    // The test does seed + materialise + dbInit (plan + apply) + dbVerify + raw read
    // — substantially more than just spinning up the DB.
    // 4× the spin-up budget gives cold CI workers headroom.
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'cross-schema FK from public.profile.userId to auth.users.id cascades on auth.users delete',
    async () => {
      const { connectionString } = database;

      // Seed external schemas + tables.
      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
      });

      // Materialise the supabase extension space on disk so dbInit can read it.
      const space = supabasePack.contractSpace;
      if (!space) {
        throw new Error('supabasePack must declare a contractSpace');
      }
      await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
        contract: space.contractJson,
        contractDts: '// supabase extension contract space\n',
        headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
      });

      // dbInit apply — creates public.profile with the cross-schema FK.
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
          contract: contractJson,
          mode: 'apply',
          migrationsDir,
        });
        if (!applyResult.ok) {
          throw new Error(`dbInit apply failed: ${applyResult.failure.summary}`);
        }
      } finally {
        await client.close();
      }

      // Grant roles access to the WAL schema created by dbInit (PGlite single-connection
      // accommodation: role-bound sessions share the connection with the WAL drain query).
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

      // Exercise the cascade.
      //
      // auth.users is foreign — non-navigable per Option B, no ORM surface.
      // We touch it via raw SQL only.
      // public.profile is ours — we use the ORM runtime to make the
      // cross-space boundary visible in the test.
      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Insert the auth.users row via raw SQL (auth.* is foreign, no ORM surface).
      await withClient(connectionString, async (pg) => {
        await pg.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
          [userId, 'bob@example.com', now],
        );
      });

      // Use the ORM for public.profile operations.
      const appDb = await createDb(connectionString);
      try {
        const sr = appDb.asServiceRole();

        // Insert a profile row via the ORM.
        await sr.execute(sr.sql.public.profile.insert([{ username: 'bob', userId }]).build());

        // Count profiles for this user before the cascade delete.
        const beforeRows = await sr.query(
          sr.sql.public.profile
            .select('id')
            .where((f, fns) => fns.eq(f.userId, userId))
            .build(),
        );
        expect(beforeRows).toHaveLength(1);

        // Delete the auth.users row via raw SQL — the cross-space FK ON DELETE CASCADE
        // fires and removes the public.profile row.
        await withClient(connectionString, async (pg) => {
          // PGlite single-connection accommodation: the role-bound `sr`
          // session above shares the physical session, and its
          // `set_config('role', 'service_role', false)` persists on it.
          // Reset so this platform-admin delete runs as postgres — on a
          // real Supabase (separate sessions) no reset is needed.
          await pg.query('RESET ROLE');
          await pg.query('DELETE FROM auth.users WHERE id = $1', [userId]);
        });

        // Count profiles for this user after the cascade delete — must be zero.
        const afterRows = await sr.query(
          sr.sql.public.profile
            .select('id')
            .where((f, fns) => fns.eq(f.userId, userId))
            .build(),
        );
        expect(afterRows).toHaveLength(0);
      } finally {
        await appDb.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});

describe('supabase RLS behavioral e2e — filtering + drift-fails-verify', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;
  let client: ReturnType<typeof createControlClient>;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'supabase-rls-e2e-'));

    await withClient(database.connectionString, async (pgClient) => {
      await setUpSupabaseMockSchema(pgClient);
    });

    const space = supabasePack.contractSpace;
    if (!space) throw new Error('supabasePack must declare a contractSpace');
    await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
      contract: space.contractJson,
      contractDts: '// supabase extension contract space\n',
      headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
    });

    client = createControlClient({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [supabasePack],
    });

    await client.connect(database.connectionString);

    const applyResult = await client.dbInit({
      contract: contractJson,
      mode: 'apply',
      migrationsDir,
    });
    if (!applyResult.ok) {
      throw new Error(
        `db init apply failed: ${applyResult.failure.summary}\n\n${JSON.stringify(applyResult.failure, null, 2)}`,
      );
    }
  }, timeouts.spinUpPpgDev * 4);

  afterEach(async () => {
    await client.close();
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'A — RLS filters rows under authenticated role + jwt GUC',
    async () => {
      const { connectionString } = database;
      const ownerA = '11111111-1111-1111-1111-111111111111';
      const ownerB = '22222222-2222-2222-2222-222222222222';

      // Insert two rows as superuser (bypasses RLS).
      // auth.users rows must exist first because profile.userId is a FK.
      await withClient(connectionString, async (pgClient) => {
        const now = new Date().toISOString();
        await pgClient.query(
          'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
          [ownerA, 'alice@example.com', now, ownerB, 'bob@example.com'],
        );
        await pgClient.query(
          'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
          [
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'alice',
            ownerA,
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            'bob',
            ownerB,
          ],
        );
        // authenticated role needs SELECT privilege to read the table under RLS.
        await pgClient.query('GRANT SELECT ON public.profile TO authenticated');
      });

      // Under SET ROLE authenticated + ownerA jwt, only alice's row is visible.
      // PostgREST pattern: set the JWT claims GUC as superuser first (session-
      // level, is_local=false so it persists across statement boundaries), then
      // switch to the authenticated role for the actual query.
      await withClient(connectionString, async (pgClient) => {
        await pgClient.query('SELECT set_config($1, $2, false)', [
          'request.jwt.claims',
          JSON.stringify({ sub: ownerA }),
        ]);
        await pgClient.query('SET ROLE authenticated');

        const result = await pgClient.query<{
          id: string;
          username: string;
          userId: string;
        }>('SELECT id, username, "userId" FROM public.profile');

        await pgClient.query('RESET ROLE');

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toEqual({
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          username: 'alice',
          userId: ownerA,
        });
      });
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'B — out-of-band DROP POLICY makes dbVerify schema result ok:false naming the policy',
    async () => {
      const { connectionString } = database;

      // Drop the policy out-of-band as superuser.
      await withClient(connectionString, async (pgClient) => {
        await pgClient.query(`DROP POLICY "${POLICY_WIRE_NAME}" ON public.profile`);
      });

      const deserializedContract = new PostgresContractSerializer().deserializeContract<Contract>(
        contractJson,
      );
      const verifyResult = await client.dbVerify({
        contract: deserializedContract,
        migrationsDir,
        strict: false,
        skipSchema: false,
        skipMarker: false,
      });

      // The operation itself succeeds (connectivity, markers ok); the schema
      // verification result for the app space carries the policy failure.
      expect(
        verifyResult.ok,
        `dbVerify operation failed unexpectedly: ${!verifyResult.ok ? JSON.stringify(verifyResult.failure) : ''}`,
      ).toBe(true);

      if (verifyResult.ok) {
        const appSchemaResult = verifyResult.value.schemaResults.get('app');
        expect(
          appSchemaResult,
          `Expected 'app' space in schemaResults; got keys: ${[...verifyResult.value.schemaResults.keys()].join(', ')}`,
        ).toBeDefined();

        expect(
          appSchemaResult?.ok,
          `Expected app schema result ok:false after DROP POLICY; issues: ${JSON.stringify(appSchemaResult?.schema.issues)}`,
        ).toBe(false);

        const policyIssue = appSchemaResult?.schema.issues.find(
          (issue) =>
            issue.expected !== undefined &&
            issue.actual === undefined &&
            (issue.expected ?? issue.actual)?.id === POLICY_WIRE_NAME,
        );
        expect(
          policyIssue,
          `Expected missing issue naming '${POLICY_WIRE_NAME}'; got: ${JSON.stringify(appSchemaResult?.schema.issues)}`,
        ).toBeDefined();
        expect(policyIssue?.expected !== undefined && policyIssue?.actual === undefined).toBe(true);
      }
    },
    timeouts.spinUpPpgDev * 4,
  );

  // Variant contract states are committed fixtures emitted by the real
  // pipeline from variant PSL sources (see test/fixtures/*.config.ts and
  // this package's `emit` script) — never mutated contract data.

  async function seedProfilesAndGrant(connectionString: string, ownerA: string, ownerB: string) {
    await withClient(connectionString, async (pgClient) => {
      const now = new Date().toISOString();
      await pgClient.query(
        'INSERT INTO auth.users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)',
        [ownerA, 'alice@example.com', now, ownerB, 'bob@example.com'],
      );
      await pgClient.query(
        'INSERT INTO public.profile (id, username, "userId") VALUES ($1, $2, $3), ($4, $5, $6)',
        [
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'alice',
          ownerA,
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          'bob',
          ownerB,
        ],
      );
      await pgClient.query('GRANT SELECT ON public.profile TO authenticated');
    });
  }

  async function rowsVisibleToAuthenticated(
    connectionString: string,
    ownerSub: string,
  ): Promise<readonly { username: string }[]> {
    return withClient(connectionString, async (pgClient) => {
      await pgClient.query('SELECT set_config($1, $2, false)', [
        'request.jwt.claims',
        JSON.stringify({ sub: ownerSub }),
      ]);
      await pgClient.query('SET ROLE authenticated');
      const result = await pgClient.query<{ username: string }>(
        'SELECT username FROM public.profile',
      );
      await pgClient.query('RESET ROLE');
      return result.rows;
    });
  }

  it(
    'C — fail-closed: removing the last policy keeps RLS on and denies all rows',
    async () => {
      const { connectionString } = database;
      const ownerA = '11111111-1111-1111-1111-111111111111';
      const ownerB = '22222222-2222-2222-2222-222222222222';
      await seedProfilesAndGrant(connectionString, ownerA, ownerB);

      // The policy filters before the change (sanity: alice sees her row).
      expect(await rowsVisibleToAuthenticated(connectionString, ownerA)).toEqual([
        { username: 'alice' },
      ]);

      // The committed no-policy fixture: the schema minus ALL policy blocks,
      // @@rls kept.
      const noPolicyContract = noPolicyContractJson;

      // Plan: exactly one drop per policy — no enablement change anywhere.
      const planResult = await client.dbUpdate({
        answerQuestions: async (questions) =>
          questions.map((question) => ({
            verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
            text: question.subject,
          })),
        contract: noPolicyContract,
        mode: 'plan',
        migrationsDir,
        acceptDataLoss: true,
      });
      if (!planResult.ok) {
        throw new Error(`db update plan failed: ${JSON.stringify(planResult.failure, null, 2)}`);
      }
      const planIds = planResult.value.plan.operations.map((op) => op.id);
      expect([...planIds].sort()).toEqual(
        [...ALL_POLICY_WIRE_NAMES.map((n) => `rlsPolicy.public.profile.${n}.drop`)].sort(),
      );

      const applyResult = await client.dbUpdate({
        answerQuestions: async (questions) =>
          questions.map((question) => ({
            verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
            text: question.subject,
          })),
        contract: noPolicyContract,
        mode: 'apply',
        migrationsDir,
        acceptDataLoss: true,
      });
      if (!applyResult.ok) {
        throw new Error(`db update apply failed: ${JSON.stringify(applyResult.failure, null, 2)}`);
      }

      // Verify clean against the policy-less (still marked) contract.
      const deserialized = new PostgresContractSerializer().deserializeContract<NoPolicyContract>(
        noPolicyContractJson,
      );
      const verifyResult = await client.dbVerify({
        contract: deserialized,
        migrationsDir,
        strict: false,
        skipSchema: false,
        skipMarker: false,
      });
      expect(
        verifyResult.ok,
        `dbVerify failed: ${!verifyResult.ok ? JSON.stringify(verifyResult.failure) : ''}`,
      ).toBe(true);
      if (verifyResult.ok) {
        for (const [spaceId, schemaResult] of verifyResult.value.schemaResults) {
          expect(
            schemaResult.ok,
            `space "${spaceId}" failed: ${JSON.stringify(schemaResult.schema?.issues)}`,
          ).toBe(true);
        }
      }

      // Behavioral proof: RLS is still enabled with zero policies — deny-all.
      expect(await rowsVisibleToAuthenticated(connectionString, ownerA)).toEqual([]);
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'D — prefix-only policy rename plans exactly one ALTER POLICY … RENAME TO and keeps filtering',
    async () => {
      const { connectionString } = database;
      const ownerA = '11111111-1111-1111-1111-111111111111';
      const ownerB = '22222222-2222-2222-2222-222222222222';
      await seedProfilesAndGrant(connectionString, ownerA, ownerB);

      // The committed renamed-policy fixture: the same policy body under the
      // prefix profile_owner_read_v2 — same content hash, new wire name.
      const renamedContract = renamedPolicyContractJson;
      const renamedWireName =
        Object.values(renamedContract.storage.namespaces.public.entries.policy)[0]?.name ?? '';
      expect(renamedWireName).toBe(
        `profile_owner_read_v2_${POLICY_WIRE_NAME.slice(POLICY_WIRE_NAME.lastIndexOf('_') + 1)}`,
      );

      // Plan: exactly one rename — no drop, no create, no enablement change.
      const planResult = await client.dbUpdate({
        answerQuestions: async (questions) =>
          questions.map((question) => ({
            verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
            text: question.subject,
          })),
        contract: renamedContract,
        mode: 'plan',
        migrationsDir,
      });
      if (!planResult.ok) {
        throw new Error(`db update plan failed: ${JSON.stringify(planResult.failure, null, 2)}`);
      }
      const planIds = planResult.value.plan.operations.map((op) => op.id);
      expect(planIds).toEqual([`rlsPolicy.public.profile.${POLICY_WIRE_NAME}.rename`]);

      const applyResult = await client.dbUpdate({
        answerQuestions: async (questions) =>
          questions.map((question) => ({
            verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
            text: question.subject,
          })),
        contract: renamedContract,
        mode: 'apply',
        migrationsDir,
      });
      if (!applyResult.ok) {
        throw new Error(`db update apply failed: ${JSON.stringify(applyResult.failure, null, 2)}`);
      }

      // Verify clean against the renamed contract.
      const deserialized =
        new PostgresContractSerializer().deserializeContract<RenamedPolicyContract>(
          renamedPolicyContractJson,
        );
      const verifyResult = await client.dbVerify({
        contract: deserialized,
        migrationsDir,
        strict: false,
        skipSchema: false,
        skipMarker: false,
      });
      expect(
        verifyResult.ok,
        `dbVerify failed: ${!verifyResult.ok ? JSON.stringify(verifyResult.failure) : ''}`,
      ).toBe(true);
      if (verifyResult.ok) {
        for (const [spaceId, schemaResult] of verifyResult.value.schemaResults) {
          expect(
            schemaResult.ok,
            `space "${spaceId}" failed: ${JSON.stringify(schemaResult.schema?.issues)}`,
          ).toBe(true);
        }
      }

      // The renamed policy still filters rows.
      expect(await rowsVisibleToAuthenticated(connectionString, ownerA)).toEqual([
        { username: 'alice' },
      ]);
    },
    timeouts.spinUpPpgDev * 4,
  );

  // Grants a role write access to the dev-harness WAL-capture schema. Under
  // `SET ROLE`, an INSERT/UPDATE fires `_prisma_dev_wal.capture_event()`, which
  // writes to `_prisma_dev_wal.events`; without these grants the role-scoped
  // write fails with `permission denied for schema _prisma_dev_wal` before RLS
  // is ever evaluated. This is the accommodation that lets us prove WITH CHECK
  // enforcement under a role (not just reads).
  async function grantWalAccess(connectionString: string, role: string): Promise<void> {
    await withClient(connectionString, async (pg) => {
      await pg.query(`GRANT USAGE ON SCHEMA _prisma_dev_wal TO ${role}`);
      await pg.query(`GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO ${role}`);
      await pg.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO ${role}`);
      await pg.query(`GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO ${role}`);
    });
  }

  it(
    'E — anon SELECT policy: under SET ROLE anon, every profile is visible (public read)',
    async () => {
      const { connectionString } = database;
      const ownerA = '11111111-1111-1111-1111-111111111111';
      const ownerB = '22222222-2222-2222-2222-222222222222';
      await seedProfilesAndGrant(connectionString, ownerA, ownerB);
      await withClient(connectionString, async (pg) => {
        await pg.query('GRANT SELECT ON public.profile TO anon');
      });

      // anon has no jwt; the `profile_public_read` policy (using = true) shows all.
      const rows = await withClient(connectionString, async (pg) => {
        await pg.query('SET ROLE anon');
        const r = await pg.query<{ username: string }>(
          'SELECT username FROM public.profile ORDER BY username',
        );
        await pg.query('RESET ROLE');
        return r.rows;
      });
      expect(rows.map((r) => r.username)).toEqual(['alice', 'bob']);
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'F — authenticated UPDATE-own: WITH CHECK enforces — a compliant update succeeds, an ownership change is rejected',
    async () => {
      const { connectionString } = database;
      const ownerA = '11111111-1111-1111-1111-111111111111';
      const ownerB = '22222222-2222-2222-2222-222222222222';
      const aliceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await seedProfilesAndGrant(connectionString, ownerA, ownerB);
      await withClient(connectionString, async (pg) => {
        await pg.query('GRANT UPDATE ON public.profile TO authenticated');
      });
      // Role-scoped writes fire the dev WAL trigger — grant the role access.
      await grantWalAccess(connectionString, 'authenticated');

      await withClient(connectionString, async (pg) => {
        await pg.query('SELECT set_config($1, $2, false)', [
          'request.jwt.claims',
          JSON.stringify({ sub: ownerA }),
        ]);
        await pg.query('SET ROLE authenticated');

        // Compliant: rename own profile. USING matches (own row); WITH CHECK
        // holds (userId unchanged, still = auth.uid()).
        const compliant = await pg.query('UPDATE public.profile SET username = $1 WHERE id = $2', [
          'alice_renamed',
          aliceId,
        ]);
        expect(compliant.rowCount).toBe(1);

        // Violating: reassign own row to another owner. WITH CHECK rejects — the
        // new row's userId (ownerB) is not auth.uid() (ownerA).
        await expect(
          pg.query('UPDATE public.profile SET "userId" = $1 WHERE id = $2', [ownerB, aliceId]),
        ).rejects.toThrow(/row-level security|policy|with check/i);

        await pg.query('RESET ROLE');
      });

      // Final state: the compliant rename landed; ownership is unchanged (the
      // violating update was rejected in full).
      const final = await withClient(connectionString, async (pg) => {
        const r = await pg.query<{ username: string; userId: string }>(
          'SELECT username, "userId" FROM public.profile WHERE id = $1',
          [aliceId],
        );
        return r.rows[0];
      });
      expect(final?.username).toBe('alice_renamed');
      expect(final?.userId).toBe(ownerA);
    },
    timeouts.spinUpPpgDev * 4,
  );

  it(
    'G — a role the contract declares but the database lacks fails db verify, naming the role',
    async () => {
      // Build a contract that declares a role the live database lacks, through
      // the real construction surface (`new PostgresRole` → `new PostgresSchema`
      // → `new SqlStorage`) — not by patching contract wire JSON. Roles cannot
      // be authored in PSL yet, so this is the same path a TypeScript-authored
      // role declaration lands on: a `role` entity in the namespace's entries.
      const base = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);
      // The deserialized namespace is a PostgresSchema at runtime; the structural
      // contract type and the class intersect to `never`, so read it through the
      // same narrowing the module header uses.
      const basePublicNs = base.storage.namespaces['public'] as unknown as PostgresSchema;
      const publicWithRole = new PostgresSchema({
        id: basePublicNs.id,
        entries: {
          ...basePublicNs.entries,
          role: {
            missing_app_role: new PostgresRole({
              name: 'missing_app_role',
              namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
            }),
          },
        },
      });
      const contractWithRole = {
        ...base,
        storage: new SqlStorage({
          // A freshly constructed test contract carries a test storage hash;
          // the marker check is skipped below because this test verifies the
          // schema (the missing role), not migration-marker identity.
          storageHash: coreHash('supabase-missing-role'),

          namespaces: { ...base.storage.namespaces, public: publicWithRole },
        }),
      };

      const verifyResult = await client.dbVerify({
        contract: contractWithRole,
        migrationsDir,
        strict: false,
        skipSchema: false,
        skipMarker: true,
      });

      expect(
        verifyResult.ok,
        `dbVerify operation failed unexpectedly: ${!verifyResult.ok ? JSON.stringify(verifyResult.failure) : ''}`,
      ).toBe(true);
      if (verifyResult.ok) {
        const appSchemaResult = verifyResult.value.schemaResults.get('app');
        expect(appSchemaResult?.ok).toBe(false);
        const roleIssue = appSchemaResult?.schema.issues.find(
          (issue) =>
            issue.expected !== undefined &&
            issue.actual === undefined &&
            issue.path.includes('missing_app_role'),
        );
        expect(
          roleIssue,
          `Expected a not-found issue naming 'missing_app_role'; got: ${JSON.stringify(appSchemaResult?.schema.issues)}`,
        ).toBeDefined();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});

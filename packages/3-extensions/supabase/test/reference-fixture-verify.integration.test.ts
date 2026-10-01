/**
 * Round-trip verify — the generated contract against the reference fixture
 * it was generated from.
 *
 *   1. Positive: `test/fixtures/supabase-reference/` is restored into a
 *      fresh PGlite database. The supabase pack space plus a minimal app
 *      space are materialised on disk, and `dbVerify` runs against the live
 *      database. The `supabase` space's schema result is expected clean
 *      (`ok: true`) — every table/column/native-enum/role this pack
 *      declares is present and matches, and the reference fixture's
 *      undeclared schemas (realtime, vault, extensions, graphql, …) are
 *      tolerated extras under `external` control.
 *
 *      A framework gap this fixture surfaced is now resolved:
 *        - Foreign-key-derived columns default to requiring a backing index
 *          (`ForeignKeyInput.index` defaults `true`, `DEFAULT_FK_INDEX` in
 *          `packages/2-sql/1-core/contract/src/types.ts`), but several real
 *          Supabase FK columns (e.g. `mfa_amr_claims.session_id`) have no
 *          physical index. PSL's `@relation` attribute now takes an `index`
 *          argument (`packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts`'s
 *          `sqlRelation` spec), and the postgres PSL inferrer's relation-inference step
 *          (`packages/2-sql/9-family/src/core/psl-contract-infer/relation-inference.ts`) stamps
 *          `index: false` on a relation whose FK columns have no live backing index, using the same
 *          column-exact-match predicate FK1's contract construction now uses to materialize a
 *          table's FK-backing `indexes[]` entries — the entries `db verify` checks against (shared
 *          as `@internal/sql-contract/foreign-key-materialization`,
 *          `packages/2-sql/1-core/contract/src/foreign-key-materialization.ts`).
 *
 *   2. Negative: on a second database, `auth.refresh_tokens` is dropped
 *      after restoring the fixture; `dbVerify` on the `supabase` space
 *      fails with a `not-found` issue naming `refresh_tokens`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { issueOutcome } from '@internal/framework-components/control';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabasePack from '../src/exports/pack';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const pgUuid = { codecId: 'pg/uuid@1', nativeType: 'uuid', nullable: false } as const;

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

describe('reference fixture round-trip verify', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'reference-fixture-verify-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  async function materialiseSpaces(appContractJson: unknown, appStorageHash: string) {
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
    await emitContractSpaceArtifacts(migrationsDir, 'app', {
      contract: appContractJson,
      contractDts: '// synthetic app contract\n',
      headRef: { hash: appStorageHash, invariants: [] },
    });
  }

  it(
    'supabase space verifies clean against the restored reference fixture; undeclared schemas tolerated',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
      });

      const appContract = buildAppContract();
      const serializer = new PostgresContractSerializer();
      const appContractJson = serializer.serializeContract(appContract);
      await materialiseSpaces(appContractJson, String(appContract.storage.storageHash));

      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [supabasePack],
      });

      try {
        await client.connect(connectionString);

        const deserializedContract = serializer.deserializeContract(appContractJson);
        const verifyResult = await client.dbVerify({
          contract: deserializedContract,
          migrationsDir,
          strict: false,
          skipSchema: false,
          skipMarker: true,
        });

        expect(
          verifyResult.ok,
          `db verify envelope failed: ${JSON.stringify(!verifyResult.ok ? verifyResult.failure : null, null, 2)}`,
        ).toBe(true);
        if (!verifyResult.ok) return;

        const supabaseResult = verifyResult.value.schemaResults.get('supabase');
        expect(supabaseResult, 'expected a schema result for the "supabase" space').toBeDefined();
        expect(
          supabaseResult?.ok,
          `supabase space verify issues: ${JSON.stringify(supabaseResult?.schema.issues, null, 2)}`,
        ).toBe(true);
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'a table the pack declares but the live database drops fails verify naming that table',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
        await client.query('DROP TABLE auth.refresh_tokens CASCADE');
      });

      const appContract = buildAppContract();
      const serializer = new PostgresContractSerializer();
      const appContractJson = serializer.serializeContract(appContract);
      await materialiseSpaces(appContractJson, String(appContract.storage.storageHash));

      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [supabasePack],
      });

      try {
        await client.connect(connectionString);

        const deserializedContract = serializer.deserializeContract(appContractJson);
        const verifyResult = await client.dbVerify({
          contract: deserializedContract,
          migrationsDir,
          strict: false,
          skipSchema: false,
          skipMarker: true,
        });

        expect(
          verifyResult.ok,
          `db verify envelope failed: ${JSON.stringify(!verifyResult.ok ? verifyResult.failure : null, null, 2)}`,
        ).toBe(true);
        if (!verifyResult.ok) return;

        const supabaseResult = verifyResult.value.schemaResults.get('supabase');
        expect(supabaseResult?.ok).toBe(false);
        const missingTableIssue = supabaseResult?.schema.issues.find(
          (issue) => issueOutcome(issue) === 'not-found' && issue.path.includes('refresh_tokens'),
        );
        expect(
          missingTableIssue,
          'expected a not-found issue naming "refresh_tokens"',
        ).toBeDefined();
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );
});

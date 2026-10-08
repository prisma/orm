/**
 * Integration test — Supabase roles enter `db verify` as first-class
 * contract entities on a live PGlite database.
 *
 *   1. Negative: a vanilla database (no `setUpSupabaseMockSchema`) fails
 *      `db verify` with a `not-found` schema issue naming each of `anon`,
 *      `authenticated`, `service_role` under the supabase contract space.
 *   2. Positive: `setUpSupabaseMockSchema` creates the roles, `db init` applies
 *      the app schema, and `db verify` passes with zero issues across every
 *      space — the role portion verifies clean when the roles exist.
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
import { SupabaseRole } from '../src/contract/roles';
import supabasePack from '../src/exports/pack';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

const pgUuid = { codecId: 'pg/uuid@1', dataType: 'pg/uuid', nullable: false } as const;

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

describe('roles enter db verify — declared in the pack contract, checked against the live database', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'roles-verify-migrations-'));
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
    'vanilla database (no shim) fails dbVerify naming each of anon, authenticated, service_role',
    async () => {
      const { connectionString } = database;
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
        expect(supabaseResult?.ok).toBe(false);

        for (const roleName of SupabaseRole.values) {
          const roleIssue = supabaseResult?.schema.issues.find(
            (issue) => issueOutcome(issue) === 'not-found' && issue.path.includes(roleName),
          );
          expect(roleIssue, `expected a not-found issue naming role "${roleName}"`).toBeDefined();
        }
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'shimmed database (roles created) passes dbInit then dbVerify with zero issues in every space',
    async () => {
      const { connectionString } = database;
      const appContract = buildAppContract();
      const serializer = new PostgresContractSerializer();
      const appContractJson = serializer.serializeContract(appContract);

      await withClient(connectionString, async (pgClient) => {
        await setUpSupabaseMockSchema(pgClient);
      });

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
        if (!verifyResult.ok) return;

        for (const [spaceId, schemaResult] of verifyResult.value.schemaResults) {
          expect(
            schemaResult.ok,
            `schema verification failed for space "${spaceId}": ${JSON.stringify(schemaResult, null, 2)}`,
          ).toBe(true);
        }
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpPpgDev * 4,
  );
});

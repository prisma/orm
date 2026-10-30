/**
 * A PSL contract with a `citext.Citext` column, applied with `db init` to a database where nothing has created the citext extension. The citext pack's migration from the empty contract installs it before the table, `db verify --strict` reports nothing, and an equality filter through the ORM matches without regard to case.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient, enrichContract } from '@internal/cli/control-api';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import citext from '@internal/extension-citext/control';
import citextRuntime from '@internal/extension-citext/runtime';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import postgresFacade from '@internal/postgres/runtime';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@internal/sql-contract/types';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit } from '../../utils/emit';
import { createIntegrationTestDir } from '../utils/cli-test-helpers';

const TEST_INVOCATION = { cwd: process.cwd(), configPath: undefined, dbGiven: false };

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [citext],
});

async function materialiseCitextPinnedArtifacts(projectRoot: string): Promise<string> {
  const migrationsDir = join(projectRoot, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  const space = citext.contractSpace;
  const createExtension = space?.migrations[0];
  if (space === undefined || createExtension === undefined) {
    throw new Error(
      'the citext descriptor declares a contract space with a migration from the empty contract',
    );
  }
  await emitContractSpaceArtifacts(migrationsDir, 'citext', {
    contract: space.contractJson,
    contractDts: '// rendered .d.ts for the citext contract space\nexport interface Contract {}\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });
  await materialiseMigrationPackage(join(migrationsDir, 'citext'), createExtension);
  return migrationsDir;
}

function createClient() {
  return createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [citext],
  });
}

describe('a citext column applied with db init', () => {
  const originalCwd = process.cwd();
  let testDir: string;

  beforeEach(() => {
    testDir = createIntegrationTestDir();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function emitContract(schemaText: string): Promise<Record<string, unknown>> {
    const schemaPath = join(testDir, 'schema.prisma');
    writeFileSync(schemaPath, `// use prisma-8\n\n${schemaText}`, 'utf-8');
    process.chdir(testDir);
    const contractConfig = prismaContract('./schema.prisma', {
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    });
    const loaded = await contractConfig.source.load({
      composedExtensions: [citext.id],
      defaultNamespaceId: stack.target.defaultNamespaceId,
      composedExtensionContracts: new Map(),
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      dataTypes: stack.dataTypes,
      controlMutationDefaults: stack.controlMutationDefaults,
      generatorFunctions: stack.generatorFunctions,
      resolvedInputs: [schemaPath],
      capabilities: stack.capabilities,
    });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure, null, 2));
    const enriched = enrichContract(loaded.value, [postgres, postgresAdapter, citext]);
    const emitted = await emit(enriched, stack, sqlEmission, sqlContractCanonicalizationHooks);
    return JSON.parse(emitted.contractJson) as Record<string, unknown>;
  }

  it(
    'installs the extension before the table, verifies clean, and matches equality without regard to case',
    async () => {
      const contractJson = await emitContract(`model User {
  id    Int           @id
  email citext.Citext
}
`);
      const migrationsDir = await materialiseCitextPinnedArtifacts(testDir);

      await withDevDatabase(async ({ connectionString }) => {
        const before = await withClient(connectionString, (client) =>
          client.query("SELECT 1 FROM pg_extension WHERE extname = 'citext'"),
        );

        const client = createClient();
        let verify: unknown;
        try {
          await client.connect(connectionString);
          const init = await client.dbInit({
            invocation: TEST_INVOCATION,
            contract: contractJson,
            mode: 'apply',
            migrationsDir,
          });
          if (!init.ok) throw new Error(JSON.stringify(init.failure, null, 2));
          const verified = await client.dbVerify({
            contract: postgres.contractSerializer.deserializeContract(contractJson),
            migrationsDir,
            strict: true,
            skipSchema: false,
            skipMarker: false,
          });
          if (!verified.ok) throw new Error(JSON.stringify(verified.failure, null, 2));
          verify = {
            markerDrift: verified.value.markerDrift,
            unclaimed: verified.value.unclaimed,
            issues: [...verified.value.schemaResults.values()].flatMap(
              (result) => result.schema.issues,
            ),
          };
        } finally {
          await client.close();
        }

        const columnType = await withClient(connectionString, (client) =>
          client.query<{ type: string }>(
            `SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
             WHERE attrelid = '"User"'::regclass AND attname = 'email'`,
          ),
        );

        const db = postgresFacade<Contract<SqlStorage>>({
          contract: postgres.contractSerializer.deserializeContract(contractJson),
          url: connectionString,
          extensions: [citextRuntime],
        });
        try {
          const users = db.orm['public']?.['User'];
          if (users === undefined) expect.unreachable('the client has the User model');
          await users.createAndCount([
            { id: 1, email: 'a@x.com' },
            { id: 2, email: 'b@x.com' },
          ]);
          const found = await users.where({ email: 'A@X.com' }).all();

          expect({
            installedBefore: before.rows.length,
            columnType: columnType.rows,
            verify,
            found,
          }).toEqual({
            installedBefore: 0,
            columnType: [{ type: 'citext' }],
            verify: { markerDrift: null, unclaimed: [], issues: [] },
            found: [{ id: 1, email: 'a@x.com' }],
          });
        } finally {
          await db.close();
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});

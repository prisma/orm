import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient, enrichContract } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
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

/**
 * Materialise pgvector's pinned contract-space artifacts under
 * `<projectRoot>/migrations/pgvector/...` so the per-space db init
 * flow (sub-spec § 6) can read its head ref + baseline migration.
 *
 * Db init requires a `migrationsDir` whenever any extension publishes
 * a contract space because the apply path reads the user repo, not the
 * descriptor.
 */
async function materialisePgvectorPinnedArtifacts(projectRoot: string): Promise<string> {
  const migrationsDir = join(projectRoot, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  const space = pgvector.contractSpace;
  if (!space) {
    throw new Error('pgvector descriptor must declare a contractSpace');
  }
  const baseline = space.migrations[0];
  if (!baseline) {
    throw new Error('pgvector contract-space must ship at least one baseline migration');
  }
  await emitContractSpaceArtifacts(migrationsDir, 'pgvector', {
    contract: space.contractJson,
    contractDts: '// rendered .d.ts for pgvector contract space\nexport interface Contract {}\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });
  await materialiseMigrationPackage(join(migrationsDir, 'pgvector'), baseline);
  return migrationsDir;
}

describe(
  'authoring: a pgvector literal default',
  () => {
    const originalCwd = process.cwd();
    const frameworkComponents = [postgres, postgresAdapter, pgvector] as const;
    let testDir: string;

    const stack = createControlStack({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [pgvector],
    });

    beforeEach(() => {
      testDir = createIntegrationTestDir();
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it(
      'is stored as the vector the codec decodes, created by dbInit, and read back from the column',
      async () => {
        const schemaPath = join(testDir, 'schema.prisma');
        writeFileSync(
          schemaPath,
          `model Document {
  id Int @id @default(autoincrement())
  embedding pgvector.Vector(3) @default([0.5, 0.25, 0.125])
}
`,
          'utf-8',
        );
        process.chdir(testDir);

        const pslResult = await prismaContract('./schema.prisma', {
          target: postgresPackRef,
          createNamespace: postgresCreateNamespace,
        }).source.load({
          composedExtensions: [pgvector.id],
          composedExtensionContracts: new Map(),
          authoringContributions: stack.authoringContributions,
          codecLookup: stack.codecLookup,
          dataTypeLookup: stack.dataTypeLookup,
          controlMutationDefaults: stack.controlMutationDefaults,
          resolvedInputs: [schemaPath],
          capabilities: stack.capabilities,
        });
        if (!pslResult.ok) {
          throw new Error(JSON.stringify(pslResult.failure.diagnostics, null, 2));
        }

        const emitted = await emit(
          enrichContract(pslResult.value, frameworkComponents),
          stack,
          sqlEmission,
          sqlContractCanonicalizationHooks,
        );
        const emittedContract = JSON.parse(emitted.contractJson) as Record<string, unknown>;
        const columns = (
          emittedContract as unknown as {
            storage: {
              namespaces: {
                public: {
                  entries: {
                    table: {
                      Document: { columns: Record<string, { default?: unknown }> };
                    };
                  };
                };
              };
            };
          }
        ).storage.namespaces.public.entries.table.Document.columns;
        expect(columns['embedding']?.default).toEqual({
          kind: 'literal',
          value: [0.5, 0.25, 0.125],
        });

        const migrationsDir = await materialisePgvectorPinnedArtifacts(testDir);

        await withDevDatabase(async ({ connectionString }) => {
          const client = createControlClient({
            family: sql,
            target: postgres,
            adapter: postgresAdapter,
            driver: postgresDriver,
            extensions: [pgvector],
          });
          try {
            await client.connect(connectionString);
            const apply = await client.dbInit({
              contract: emittedContract,
              mode: 'apply',
              migrationsDir,
            });
            if (!apply.ok) {
              throw new Error(`dbInit apply failed: ${JSON.stringify(apply.failure, null, 2)}`);
            }
          } finally {
            await client.close();
          }

          await withClient(connectionString, async (raw) => {
            await raw.query('INSERT INTO "Document" DEFAULT VALUES');
            const read = await raw.query<{ embedding: string }>(
              'SELECT "embedding"::text FROM "Document"',
            );
            expect(read.rows.map((row) => row.embedding)).toEqual(['[0.5,0.25,0.125]']);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
  timeouts.spinUpPpgDev,
);

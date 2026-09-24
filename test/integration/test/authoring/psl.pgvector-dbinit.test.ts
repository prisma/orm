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
  'authoring: PSL → emit → dbInit / dbUpdate',
  () => {
    const originalCwd = process.cwd();
    const frameworkComponents = [postgres, postgresAdapter, pgvector] as const;
    let testDir: string;

    const stack = createControlStack({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
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

    async function emitPgvectorContract(schemaText: string): Promise<Record<string, unknown>> {
      const schemaPath = join(testDir, 'schema.prisma');
      writeFileSync(schemaPath, `// use prisma-8\n\n${schemaText}`, 'utf-8');

      process.chdir(testDir);
      const contractConfig = prismaContract('./schema.prisma', {
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
      });

      const pslResult = await contractConfig.source.load({
        composedExtensions: [pgvector.id],
        composedExtensionContracts: new Map(),
        authoringContributions: stack.authoringContributions,
        codecLookup: stack.codecLookup,
        dataTypeLookup: stack.dataTypeLookup,
        controlMutationDefaults: stack.controlMutationDefaults,
        resolvedInputs: [schemaPath],
        capabilities: stack.capabilities,
      });
      expect(pslResult.ok).toBe(true);
      if (!pslResult.ok) {
        throw new Error('expected pgvector PSL source emission to succeed');
      }

      const enrichedIR = enrichContract(pslResult.value, frameworkComponents);

      // Thread the SQL family's canonicalization hooks so the emitted
      // contract preserves the empty `uniques`/`indexes`/`foreignKeys`
      // arrays the SQL contract validator requires — production emit gets
      // these from `descriptor.contractSerializer`; this inline emit must
      // supply them the same way the side-by-side fixture test does.
      const emitted = await emit(enrichedIR, stack, sqlEmission, sqlContractCanonicalizationHooks);
      return JSON.parse(emitted.contractJson) as Record<string, unknown>;
    }

    async function withPgvectorControlClient<T>(
      connectionString: string,
      fn: (client: ReturnType<typeof createControlClient>) => Promise<T>,
    ): Promise<T> {
      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [pgvector],
      });

      try {
        await client.connect(connectionString);
        return await fn(client);
      } finally {
        await client.close();
      }
    }

    it(
      'dbInit succeeds for a PSL-emitted pgvector named type schema',
      async () => {
        const emittedContract = await emitPgvectorContract(`types {
  Embedding1536 = pgvector.Vector(1536)
}

model Document {
  id Int @id @default(autoincrement())
  embedding Embedding1536
}
`);

        const migrationsDir = await materialisePgvectorPinnedArtifacts(testDir);

        await withDevDatabase(async ({ connectionString }) => {
          await withPgvectorControlClient(connectionString, async (client) => {
            const plan = await client.dbInit({
              contract: emittedContract,
              mode: 'plan',
              migrationsDir,
            });
            expect(plan.ok).toBe(true);
            if (!plan.ok) {
              throw new Error(`dbInit plan failed: ${plan.failure.summary}`);
            }

            const ddl =
              plan.value.plan.preview?.statements
                .filter((s) => s.language === 'sql')
                .map((s) => s.text)
                .join(';\n\n') ?? '';
            expect(ddl).toContain('vector(1536)');
            expect(ddl).not.toContain('"vector(1536)"');

            const apply = await client.dbInit({
              contract: emittedContract,
              mode: 'apply',
              migrationsDir,
            });
            if (!apply.ok) {
              throw new Error(
                `dbInit apply failed: ${apply.failure.summary}\n\n${JSON.stringify(apply.failure, null, 2)}`,
              );
            }
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'dbUpdate recovers a dropped pgvector NOT NULL column on a non-empty table',
      async () => {
        const emittedContract = await emitPgvectorContract(`types {
  Embedding3 = pgvector.Vector(3)
}

model Document {
  id Int @id @default(autoincrement())
  embedding Embedding3
}
`);

        const migrationsDir = await materialisePgvectorPinnedArtifacts(testDir);

        await withDevDatabase(async ({ connectionString }) => {
          await withPgvectorControlClient(connectionString, async (client) => {
            const init = await client.dbInit({
              contract: emittedContract,
              mode: 'apply',
              migrationsDir,
            });
            if (!init.ok) {
              throw new Error(
                `dbInit apply failed: ${init.failure.summary}\n\n${JSON.stringify(init.failure, null, 2)}`,
              );
            }
          });

          let documentId = 0;
          await withClient(connectionString, async (client) => {
            const inserted = await client.query<{ id: number }>(
              `INSERT INTO "Document" ("embedding") VALUES ('[1,2,3]') RETURNING "id"`,
            );
            documentId = inserted.rows[0]?.id ?? 0;
            expect(documentId).toBeGreaterThan(0);

            await client.query('ALTER TABLE "Document" DROP COLUMN "embedding"');
          });

          await withPgvectorControlClient(connectionString, async (client) => {
            const update = await client.dbUpdate({
              contract: emittedContract,
              mode: 'apply',
              migrationsDir,
            });
            if (!update.ok) {
              throw new Error(
                `dbUpdate apply failed: ${update.failure.summary}\n\n${JSON.stringify(update.failure, null, 2)}`,
              );
            }
          });

          await withClient(connectionString, async (client) => {
            const restoredRows = await client.query<{ embedding_text: string }>(
              `SELECT "embedding"::text AS embedding_text
               FROM "Document"
               WHERE "id" = $1`,
              [documentId],
            );
            expect(restoredRows.rows).toEqual([{ embedding_text: '[0,0,0]' }]);

            const defaultCheck = await client.query<{ column_default: string | null }>(`
              SELECT column_default
              FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'Document'
                AND column_name = 'embedding'
            `);
            expect(defaultCheck.rows[0]?.column_default ?? null).toBeNull();
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  },
  timeouts.spinUpPpgDev,
);

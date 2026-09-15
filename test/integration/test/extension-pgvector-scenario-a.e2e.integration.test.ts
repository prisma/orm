import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
/**
 * Scenario A end-to-end against PGlite — pgvector contract-space
 * (project: extension-contract-spaces, M4 / T4.3).
 *
 * This test was relocated from
 * `packages/3-extensions/pgvector/test/scenario-a.e2e.integration.test.ts`
 * to `test/integration/` so that pgvector's package can stop declaring
 * adapter-postgres / cli / driver-postgres / target-postgres as
 * `devDependencies`. Those declarations created a turbo dep-graph
 * cycle (adapter-postgres already declares pgvector as a `devDependency`
 * for cast-policy / planner-storage-types tests; the new pgvector e2e
 * test added a back-edge through pgvector → adapter-postgres). The
 * cycle blocks `pnpm test:packages` workspace-wide. `test/integration`
 * already declares all four of those packages, so it is the
 * conventional home for this kind of cross-package e2e suite (matches
 * the precedent in commit `8efd264c7 refactor(target-postgres): break
 * Turbo dep cycle by relocating runtime-dep tests`).
 *
 * Public-export-only consumption: this file imports pgvector solely
 * via `@internal/extension-pgvector/control` (the published
 * descriptor). The few `pgvector:*` string constants we need are
 * inlined here with comments tying them to their source-of-truth
 * locations.
 *
 * Drives the CLI aggregate `db init` flow (`executeDbInit`,
 * sub-spec § 6) against a real Postgres (PGlite via
 * `createDevDatabase`) with pgvector wired as an extension space and a
 * user `Doc` table that carries a `vector(N)` column. Three layers of
 * coverage:
 *
 *   1. **Pinned `ops.json` byte-equivalence (disk).** Closes project
 *      AC10 / TC-15 at the on-disk shape level — the `CREATE EXTENSION
 *      IF NOT EXISTS vector` SQL flows through
 *      `installVectorExtension.execute[0].sql` and is serialised
 *      byte-for-byte.
 *
 *   2. **Multi-space planning (real DDL).** `executeDbInit`
 *      with `mode: 'plan'` against the real descriptor produces a plan
 *      that includes the pgvector baseline op AND the app-space
 *      `CREATE TABLE Doc` op, ordered first per
 *      `concatenateSpaceApplyInputs` cross-space ordering.
 *
 *   3. **Multi-space apply (synthetic vector stub).** PGlite does not
 *      ship the `vector` extension; the synthetic-stub variant
 *      replaces the install op's SQL with a `CREATE DOMAIN vector AS
 *      text` stub so the framework + per-space wiring runs against a
 *      real DB. Asserts marker rows for both `app` and `pgvector`
 *      (project AC5 / AC10 / TC-16).
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterDescriptor from '@internal/adapter-postgres/control';
import { executeDbInit } from '@internal/cli/control-api';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresDriverDescriptor from '@internal/driver-postgres/control';
import pgvectorExtensionDescriptor from '@internal/extension-pgvector/control';
import sqlFamilyDescriptor, { type SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { createControlStack, type MigrationPackage } from '@internal/framework-components/control';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetDescriptor, { parsePostgresListText } from '@internal/target-postgres/control';
import { applicationDomainOf, createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// String constants pinned by source of truth in
// `packages/3-extensions/pgvector/src/core/constants.ts` and
// `contract-space-constants.ts`. Inlined here so this test can consume
// pgvector through its public `/control` export without a relative
// path back into the package's `src/`. If the package ever changes
// these values (FR11 makes the invariantId immutable, but the others
// are not), the descriptor self-consistency assertion in
// `packages/3-extensions/pgvector/test/descriptor.test.ts` will fail
// first and lead the implementer here.
const VECTOR_CODEC_ID = 'pg/vector@1' as const;
const PGVECTOR_NATIVE_TYPE = 'vector' as const;
const PGVECTOR_SPACE_ID = 'pgvector' as const;
const PGVECTOR_INSTALL_INVARIANT_ID = 'pgvector:install-vector-v1' as const;

function getPgvectorContractSpace(): NonNullable<typeof pgvectorExtensionDescriptor.contractSpace> {
  const space = pgvectorExtensionDescriptor.contractSpace;
  if (!space) {
    throw new Error('pgvectorExtensionDescriptor must declare a contractSpace');
  }
  return space;
}

function getPgvectorBaselineMigration(): MigrationPackage {
  const migrations = getPgvectorContractSpace().migrations;
  const baseline = migrations[0];
  if (!baseline) {
    throw new Error('pgvector contract-space must ship at least one baseline migration');
  }
  return baseline;
}

const pgvectorContract = getPgvectorContractSpace().contractJson;
const pgvectorHeadRef = getPgvectorContractSpace().headRef;
const pgvectorBaselineMigration = getPgvectorBaselineMigration();
const PGVECTOR_STORAGE_HASH = pgvectorContract.storage.storageHash;

const APP_CONTRACT_HASH = coreHash('pgvector-e2e-app-v1');
const APP_PROFILE_HASH = profileHash('pgvector-e2e-app-profile-v1');
const APP_TABLE = 'Doc';
const APP_FIELD = 'embedding';
const VECTOR_LENGTH = 3;

function buildAppContract(opts: { readonly withLength: boolean }): Contract<SqlStorage> {
  return familyInstance.deserializeContract(buildAppContractPojo(opts)) as Contract<SqlStorage>;
}

function buildAppContractPojo(opts: { readonly withLength: boolean }): Contract<SqlStorage> {
  const embeddingColumn: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly nullable: boolean;
    readonly typeParams?: Record<string, unknown>;
  } = opts.withLength
    ? {
        codecId: VECTOR_CODEC_ID,
        nativeType: PGVECTOR_NATIVE_TYPE,
        nullable: false,
        typeParams: { length: VECTOR_LENGTH },
      }
    : {
        codecId: VECTOR_CODEC_ID,
        nativeType: PGVECTOR_NATIVE_TYPE,
        nullable: false,
      };

  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: APP_PROFILE_HASH,
    storage: {
      storageHash: APP_CONTRACT_HASH,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          kind: 'postgres-schema',
          entries: {
            table: {
              [APP_TABLE]: {
                columns: {
                  id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                  [APP_FIELD]: embeddingColumn,
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const controlStack = createControlStack({
  family: sqlFamilyDescriptor,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensions: [pgvectorExtensionDescriptor],
});
const familyInstance = sqlFamilyDescriptor.create(controlStack);
const controlAdapter = postgresAdapterDescriptor.create(controlStack);

const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
  pgvectorExtensionDescriptor,
] as const;

/**
 * Synthetic stand-in for `CREATE EXTENSION IF NOT EXISTS vector`.
 * PGlite does not ship the `vector` extension; this stub creates a
 * `vector` text-domain so the codec's `expandNativeType` hook resolves
 * `vector(N)` (which then degrades to `vector` here, ignoring the
 * parenthesised length — `text` accepts any string content).
 */
function buildSyntheticVectorInstallSql(): string {
  return [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${PGVECTOR_NATIVE_TYPE}') THEN
         CREATE DOMAIN public."${PGVECTOR_NATIVE_TYPE}" AS text;
       END IF;
     END $$;`,
  ].join('\n');
}

/**
 * Build a synthetic-vector variant of `pgvectorBaselineMigration`.
 * Identical structure to the real package — same dirName, same
 * structural shape, same headRef hash semantics — but with the
 * `installVectorExtension` op's `execute[]` SQL replaced by
 * {@link buildSyntheticVectorInstallSql}. The migrationHash is
 * recomputed because the on-disk representation differs.
 */
function buildSyntheticBaselineMigration(): MigrationPackage {
  const realOps = pgvectorBaselineMigration.ops;
  const syntheticOps = realOps.map((op) => {
    const sqlOp = op as unknown as SqlMigrationPlanOperation<unknown>;
    if (sqlOp.invariantId !== PGVECTOR_INSTALL_INVARIANT_ID) {
      return op;
    }
    return {
      ...sqlOp,
      precheck: [],
      execute: [
        {
          description: 'Synthetic stub vector type (PGlite-compatible)',
          sql: buildSyntheticVectorInstallSql(),
        },
      ],
      postcheck: [],
    };
  });

  const baseMetadata = {
    from: pgvectorBaselineMigration.metadata.from,
    to: pgvectorBaselineMigration.metadata.to,
    providedInvariants: pgvectorBaselineMigration.metadata.providedInvariants,
    createdAt: pgvectorBaselineMigration.metadata.createdAt,
  };

  return {
    dirName: pgvectorBaselineMigration.dirName,
    metadata: {
      ...baseMetadata,
      migrationHash: computeMigrationHash(baseMetadata, syntheticOps),
    },
    ops: syntheticOps,
  };
}

interface TestProject {
  readonly projectRoot: string;
  readonly migrationsDir: string;
  readonly pgvectorBaselineDir: string;
}

async function setupTestProject(args: {
  readonly migration: MigrationPackage;
}): Promise<TestProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pgvector-scenario-a-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitContractSpaceArtifacts(migrationsDir, PGVECTOR_SPACE_ID, {
    contract: pgvectorContract,
    contractDts: '// rendered .d.ts for pgvector contract space\nexport interface Contract {}\n',
    headRef: { hash: pgvectorHeadRef.hash, invariants: [...pgvectorHeadRef.invariants] },
  });

  const pgvectorSpaceDir = join(migrationsDir, PGVECTOR_SPACE_ID);
  await materialiseMigrationPackage(pgvectorSpaceDir, args.migration);

  return {
    projectRoot,
    migrationsDir,
    pgvectorBaselineDir: join(pgvectorSpaceDir, args.migration.dirName),
  };
}

describe('pgvector Scenario A end-to-end (PGlite, T4.3)', {
  concurrent: false,
  timeout: timeouts.spinUpPpgDev,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>> | undefined;
  let project: TestProject | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    driver = await postgresDriverDescriptor.create(database.connectionString);
    await driver.query('drop schema if exists public cascade');
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('create schema public');
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
    if (project) {
      await rm(project.projectRoot, { recursive: true, force: true });
      project = undefined;
    }
  });

  it('pinned ops.json carries the CREATE EXTENSION SQL byte-for-byte (TC-15)', async () => {
    project = await setupTestProject({ migration: pgvectorBaselineMigration });
    const opsPath = join(project.pgvectorBaselineDir, 'ops.json');
    const opsRaw = await readFile(opsPath, 'utf-8');
    const ops = JSON.parse(opsRaw) as ReadonlyArray<{
      readonly invariantId?: string;
      readonly execute?: ReadonlyArray<{ readonly sql: string }>;
    }>;
    const installOp = ops.find((op) => op.invariantId === PGVECTOR_INSTALL_INVARIANT_ID);
    expect(installOp).toBeDefined();
    expect(installOp?.execute?.[0]?.sql).toBe('CREATE EXTENSION IF NOT EXISTS vector');
  });

  it('mode=plan against the real install op produces a plan across spaces', async () => {
    project = await setupTestProject({ migration: pgvectorBaselineMigration });

    const result = await executeDbInit({
      driver: driver!,
      adapter: controlAdapter,
      familyInstance,
      contract: buildAppContract({ withLength: true }),
      mode: 'plan',
      migrations: postgresTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: project.migrationsDir,
      targetId: 'postgres',
      extensions: [pgvectorExtensionDescriptor],
    });

    if (!result.ok) {
      throw new Error(
        `Expected plan ok but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }
    const operations = result.value.plan.operations;
    expect(operations.length).toBeGreaterThan(0);

    const opIdsInOrder = operations.map((op: { readonly id: string }) => op.id);
    const installIdx = opIdsInOrder.findIndex(
      (id: string) => id === 'pgvector.install-vector-extension',
    );
    const appDocIdx = opIdsInOrder.findIndex((id: string) => id.includes(APP_TABLE));

    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(appDocIdx).toBeGreaterThan(installIdx);
  });

  it('synthetic vector stub: applies pgvector + app-space atomically; markers + round-trip OK', async () => {
    project = await setupTestProject({ migration: buildSyntheticBaselineMigration() });

    const result = await executeDbInit({
      driver: driver!,
      adapter: controlAdapter,
      familyInstance,
      contract: buildAppContract({ withLength: false }),
      mode: 'apply',
      migrations: postgresTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: project.migrationsDir,
      targetId: 'postgres',
      extensions: [pgvectorExtensionDescriptor],
    });

    if (!result.ok) {
      throw new Error(
        `Expected db apply success but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }

    const markers = await driver!.query<{
      space: string;
      core_hash: string;
      invariants: string;
    }>('select space, core_hash, invariants from prisma_contract.marker order by space');
    const markerBySpace = new Map(markers.rows.map((row) => [row.space, row]));

    expect(markerBySpace.has('app')).toBe(true);
    expect(markerBySpace.has(PGVECTOR_SPACE_ID)).toBe(true);

    const pgvectorMarker = markerBySpace.get(PGVECTOR_SPACE_ID);
    expect(pgvectorMarker?.core_hash).toBe(PGVECTOR_STORAGE_HASH);
    expect([...parsePostgresListText(pgvectorMarker?.invariants)].sort()).toEqual(
      [...pgvectorHeadRef.invariants].sort(),
    );

    expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH);

    const docTable = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public."${APP_TABLE}"') is not null as exists`,
    );
    expect(docTable.rows[0]?.exists).toBe(true);

    await driver!.query(
      `insert into public."${APP_TABLE}" ("id", "${APP_FIELD}") values ($1, $2)`,
      ['doc-1', '[1,2,3]'],
    );
    const row = await driver!.query<{ id: string; embedding: string }>(
      `select "id", "${APP_FIELD}" as embedding from public."${APP_TABLE}"`,
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0]?.id).toBe('doc-1');
    expect(row.rows[0]?.embedding).toBe('[1,2,3]');
  });
});

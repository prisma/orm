/**
 * pgvector's contract space through `db init` against PGlite, which ships the `vector` extension. The pack's contract declares the extension, so the planner creates it from the pack's migration that starts at the empty contract, before the app space's `Doc` table and its `vector(N)` column. Both spaces get markers, neither records an invariant, and a `Doc` row with an embedding round-trips.
 *
 * pgvector is consumed only through its published `/control` export.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterDescriptor from '@internal/adapter-postgres/control';
import { executeDbInit } from '@internal/cli/control-api';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresDriverDescriptor from '@internal/driver-postgres/control';
import pgvectorExtensionDescriptor from '@internal/extension-pgvector/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetDescriptor, { parsePostgresListText } from '@internal/target-postgres/control';
import { applicationDomainOf, createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_INVOCATION = { cwd: process.cwd(), configPath: undefined, dbGiven: false };

const VECTOR_CODEC_ID = 'pg/vector@1' as const;
const PGVECTOR_SPACE_ID = 'pgvector' as const;

function getPgvectorContractSpace(): NonNullable<typeof pgvectorExtensionDescriptor.contractSpace> {
  const space = pgvectorExtensionDescriptor.contractSpace;
  if (!space) {
    throw new Error('pgvectorExtensionDescriptor must declare a contractSpace');
  }
  return space;
}

const pgvectorContract = getPgvectorContractSpace().contractJson;
const pgvectorHeadRef = getPgvectorContractSpace().headRef;
const PGVECTOR_STORAGE_HASH = pgvectorContract.storage.storageHash;

const APP_CONTRACT_HASH = coreHash('pgvector-e2e-app-v1');
const APP_PROFILE_HASH = profileHash('pgvector-e2e-app-profile-v1');
const APP_TABLE = 'Doc';
const APP_FIELD = 'embedding';
const VECTOR_LENGTH = 3;

function buildAppContract(): Contract<SqlStorage> {
  return familyInstance.deserializeContract(buildAppContractPojo()) as Contract<SqlStorage>;
}

function buildAppContractPojo(): Contract<SqlStorage> {
  const embeddingColumn = {
    codecId: VECTOR_CODEC_ID,
    dataType: 'pgvector/vector',
    nullable: false,
    many: false as const,
    typeParams: { length: VECTOR_LENGTH },
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
                  id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false, many: false },
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

interface TestProject {
  readonly projectRoot: string;
  readonly migrationsDir: string;
}

async function setupTestProject(): Promise<TestProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pgvector-db-init-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitContractSpaceArtifacts(migrationsDir, PGVECTOR_SPACE_ID, {
    contract: pgvectorContract,
    contractDts: '// rendered .d.ts for pgvector contract space\nexport interface Contract {}\n',
    headRef: { hash: pgvectorHeadRef.hash, invariants: [...pgvectorHeadRef.invariants] },
  });

  const pgvectorSpaceDir = join(migrationsDir, PGVECTOR_SPACE_ID);
  for (const migration of getPgvectorContractSpace().migrations) {
    await materialiseMigrationPackage(pgvectorSpaceDir, migration);
  }

  return { projectRoot, migrationsDir };
}

describe('pgvector contract space through db init (PGlite)', {
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

  it('plans the vector extension before the app space table', async () => {
    project = await setupTestProject();

    const result = await executeDbInit({
      invocation: TEST_INVOCATION,
      driver: driver!,
      adapter: controlAdapter,
      familyInstance,
      contract: buildAppContract(),
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
    const opIdsInOrder = result.value.plan.operations.map((op: { readonly id: string }) => op.id);
    const extensionIdx = opIdsInOrder.indexOf('extension.vector');
    const appDocIdx = opIdsInOrder.findIndex((id: string) => id.includes(APP_TABLE));

    expect(extensionIdx).toBeGreaterThanOrEqual(0);
    expect(appDocIdx).toBeGreaterThan(extensionIdx);
  });

  it('creates the extension and the app table; markers record no invariant; a Doc row round-trips', async () => {
    project = await setupTestProject();

    const result = await executeDbInit({
      invocation: TEST_INVOCATION,
      driver: driver!,
      adapter: controlAdapter,
      familyInstance,
      contract: buildAppContract(),
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
    expect([...parsePostgresListText(pgvectorMarker?.invariants)]).toEqual([]);

    expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH);

    const docTable = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public."${APP_TABLE}"') is not null as exists`,
    );
    expect(docTable.rows[0]?.exists).toBe(true);

    await driver!.query(
      `insert into public."${APP_TABLE}" ("id", "${APP_FIELD}") values ($1, $2::vector)`,
      ['doc-1', '[1,2,3]'],
    );
    const row = await driver!.query<{ id: string; embedding: string }>(
      `select "id", "${APP_FIELD}"::text as embedding from public."${APP_TABLE}"`,
    );
    expect(row.rows).toEqual([{ id: 'doc-1', embedding: '[1,2,3]' }]);
  });
});

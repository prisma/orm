import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeDbInit, executeDbUpdate } from '@internal/cli/control-api';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { materialiseMigrationPackage } from '@internal/migration-tools/io';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  contract as appContract,
  controlAdapter,
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * End-to-end coverage for the CLI aggregate `db init` / `db update`
 * pipeline against a real Postgres database (PGlite via dev-database)
 * with on-disk on-disk artifacts.
 *
 * Postgres equivalent of the SQLite `db-init-update.cli.test.ts`.
 *
 * Locks the CLI-level half of:
 * - rollback — a failure in any space rolls back every space's
 *   writes and preserves pre-execution markers.
 * - AM9 (atomic init across spaces).
 * - AM10 (only the bumped extension advances on a follow-up update).
 *
 * The runner-level half of AM12 is locked by the existing
 * `runner.across-spaces.integration.test.ts` in this package.
 */

const EXT_SPACE_ID = 'pg_ext_test_contract_space';
const EXT_BASELINE_DIR = '20260101T0000_create_helper';

// Stable 64-hex-char storage hashes: the contract-snapshot store keys its
// on-disk directory by `storageHashHex(storage.storageHash)`, which requires
// a well-formed 64-hex value.
const EXT_STORAGE_HASH_V1 = '3'.repeat(64);
const EXT_STORAGE_HASH_V2 = '4'.repeat(64);

function buildExtensionContract(version: 1 | 2): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(`pg-ext-test-v${version}`),
    storage: new SqlStorage({
      storageHash: coreHash(version === 1 ? EXT_STORAGE_HASH_V1 : EXT_STORAGE_HASH_V2),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              _ext_helper: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  ...(version === 2
                    ? {
                        note: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true },
                      }
                    : {}),
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

const extContractV1 = buildExtensionContract(1);
const extContractV2 = buildExtensionContract(2);

function buildBaselineOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.create-helper',
      label: 'Create extension helper table',
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: { schema: 'public', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'create _ext_helper',
          sql: 'CREATE TABLE public._ext_helper (id integer PRIMARY KEY)',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

function buildAdvanceOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.add-helper.note',
      label: 'Add note column to _ext_helper',
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: { schema: 'public', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'add note column',
          sql: 'ALTER TABLE public._ext_helper ADD COLUMN note TEXT',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

function buildFailingOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'ext.always-fails',
      label: 'Always-failing extension op',
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: { schema: 'public', objectType: 'table', name: '_ext_helper' },
      },
      precheck: [],
      execute: [
        {
          description: 'forced failure',
          sql: "DO $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$",
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

interface ContractSpaceArtifactSetup {
  readonly migrationsDir: string;
  readonly tmpRoot: string;
}

async function writeExtensionContractSpaceArtifacts(args: {
  readonly tmpRoot: string;
  readonly contract: Contract<SqlStorage>;
  readonly headHash: string;
  readonly invariants: readonly string[];
  readonly migrationDirName: string;
  readonly fromHash: string | null;
  readonly toHash: string;
  readonly ops: readonly MigrationPlanOperation[];
}): Promise<ContractSpaceArtifactSetup> {
  const migrationsDir = join(args.tmpRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitContractSpaceArtifacts(migrationsDir, EXT_SPACE_ID, {
    contract: args.contract,
    contractDts: '// placeholder\nexport {};\n',
    headRef: { hash: args.headHash, invariants: [...args.invariants] },
  });

  const spaceDir = join(migrationsDir, EXT_SPACE_ID);
  const baseMeta = {
    from: args.fromHash,
    to: args.toHash,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const ops = [...args.ops];
  await materialiseMigrationPackage(spaceDir, {
    dirName: args.migrationDirName,
    metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
    ops,
  });

  return { migrationsDir, tmpRoot: args.tmpRoot };
}

function buildExtensionPack(args: {
  readonly contractJson: Contract<SqlStorage>;
  readonly headHash: string;
}): SqlControlExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id: EXT_SPACE_ID,
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    contractSpace: {
      contractJson: args.contractJson,
      migrations: [],
      headRef: { hash: args.headHash, invariants: [] },
    },
    create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
  } as unknown as SqlControlExtensionDescriptor<'postgres'>;
}

describe('db init / db update aggregate pipeline (CLI) - postgres', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;
  let tmpRoot: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    tmpRoot = await mkdtemp(join(tmpdir(), 'prisma-pg-cli-test-'));
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
    await rm(tmpRoot, { recursive: true, force: true });
  }, testTimeout);

  afterEach(async () => {
    if (driver) await resetDatabase(driver);
  }, testTimeout);

  async function freshDriver(): Promise<PostgresControlDriver> {
    if (driver) {
      await resetDatabase(driver);
      return driver;
    }
    driver = await createDriver(database.connectionString);
    return driver;
  }

  async function freshTmpDir(label: string): Promise<string> {
    const dir = await mkdtemp(join(tmpRoot, `${label}-`));
    return dir;
  }

  async function setupBaseline(tmp: string): Promise<ContractSpaceArtifactSetup> {
    return writeExtensionContractSpaceArtifacts({
      tmpRoot: tmp,
      contract: extContractV1,
      headHash: extContractV1.storage.storageHash,
      invariants: [],
      migrationDirName: EXT_BASELINE_DIR,
      fromHash: null,
      toHash: extContractV1.storage.storageHash,
      ops: buildBaselineOps(),
    });
  }

  it(
    'initialises both spaces atomically on a fresh database (locks AM9)',
    async () => {
      const drv = await freshDriver();
      const tmp = await freshTmpDir('init');
      const { migrationsDir } = await setupBaseline(tmp);

      const result = await executeDbInit({
        driver: drv,
        adapter: controlAdapter,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir,
        targetId: 'postgres',
        extensions: [
          buildExtensionPack({
            contractJson: extContractV1,
            headHash: extContractV1.storage.storageHash,
          }),
        ],
      });

      if (!result.ok) {
        throw new Error(`Expected ok but got failure: ${JSON.stringify(result.failure, null, 2)}`);
      }
      expect(result.ok).toBe(true);

      const markers = await drv.query<{ space: string; core_hash: string }>(
        'select space, core_hash from prisma_contract.marker order by space',
      );
      expect(markers.rows.map((r) => r.space).sort()).toEqual(['app', EXT_SPACE_ID].sort());
      expect(markers.rows.find((r) => r.space === 'app')!.core_hash).toBe(
        appContract.storage.storageHash,
      );
      expect(markers.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
        extContractV1.storage.storageHash,
      );

      const userTable = await drv.query<{ cnt: number }>(
        "select count(*)::int as cnt from information_schema.tables where table_schema='public' and table_name='user'",
      );
      expect(userTable.rows[0]!.cnt).toBe(1);

      const helperTable = await drv.query<{ cnt: number }>(
        "select count(*)::int as cnt from information_schema.tables where table_schema='public' and table_name='_ext_helper'",
      );
      expect(helperTable.rows[0]!.cnt).toBe(1);
    },
    testTimeout,
  );

  it(
    'advances only the bumped extension space on a follow-up update (locks AM10)',
    async () => {
      const drv = await freshDriver();
      const tmp = await freshTmpDir('update');
      const baseline = await setupBaseline(tmp);

      const initResult = await executeDbInit({
        driver: drv,
        adapter: controlAdapter,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'postgres',
        extensions: [
          buildExtensionPack({
            contractJson: extContractV1,
            headHash: extContractV1.storage.storageHash,
          }),
        ],
      });
      expect(initResult.ok).toBe(true);

      // Bump extension to v2: emit the v2 head ref and a follow-on
      // migration package. The graph now has two edges (null→v1, v1→v2);
      // the marker is at v1 so only the second edge walks.
      await emitContractSpaceArtifacts(baseline.migrationsDir, EXT_SPACE_ID, {
        contract: extContractV2,
        contractDts: '// placeholder\nexport {};\n',
        headRef: { hash: extContractV2.storage.storageHash, invariants: [] },
      });
      {
        const baseMeta = {
          from: extContractV1.storage.storageHash,
          to: extContractV2.storage.storageHash,
          providedInvariants: [],
          createdAt: '2026-02-01T00:00:00.000Z',
        };
        const ops = [...buildAdvanceOps()];
        await materialiseMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
          dirName: '20260201T0000_add_note',
          metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
          ops,
        });
      }

      const updateResult = await executeDbUpdate({
        driver: drv,
        adapter: controlAdapter,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'postgres',
        extensions: [
          buildExtensionPack({
            contractJson: extContractV2,
            headHash: extContractV2.storage.storageHash,
          }),
        ],
        acceptDataLoss: true,
      });
      if (!updateResult.ok) {
        throw new Error(
          `Expected update ok but got failure: ${JSON.stringify(updateResult.failure, null, 2)}`,
        );
      }
      expect(updateResult.ok).toBe(true);

      const markers = await drv.query<{ space: string; core_hash: string }>(
        'select space, core_hash from prisma_contract.marker order by space',
      );
      expect(markers.rows.find((r) => r.space === 'app')!.core_hash).toBe(
        appContract.storage.storageHash,
      );
      expect(markers.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
        extContractV2.storage.storageHash,
      );

      const cols = await drv.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='public' and table_name='_ext_helper' order by column_name",
      );
      expect(cols.rows.map((r) => r.column_name)).toEqual(['id', 'note']);
    },
    testTimeout,
  );

  it(
    'rolls back ALL spaces and preserves pre-execution markers when any space fails (locks AM4-rollback)',
    async () => {
      const drv = await freshDriver();
      const tmp = await freshTmpDir('rollback');
      const baseline = await setupBaseline(tmp);

      const initResult = await executeDbInit({
        driver: drv,
        adapter: controlAdapter,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'postgres',
        extensions: [
          buildExtensionPack({
            contractJson: extContractV1,
            headHash: extContractV1.storage.storageHash,
          }),
        ],
      });
      expect(initResult.ok).toBe(true);

      const markersBefore = await drv.query<{ space: string; core_hash: string }>(
        'select space, core_hash from prisma_contract.marker order by space',
      );
      const appHashBefore = markersBefore.rows.find((r) => r.space === 'app')!.core_hash;
      const extHashBefore = markersBefore.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash;

      // Bump extension to v2 with a failing op.
      await emitContractSpaceArtifacts(baseline.migrationsDir, EXT_SPACE_ID, {
        contract: extContractV2,
        contractDts: '// placeholder\nexport {};\n',
        headRef: { hash: extContractV2.storage.storageHash, invariants: [] },
      });
      {
        const baseMeta = {
          from: extContractV1.storage.storageHash,
          to: extContractV2.storage.storageHash,
          providedInvariants: [],
          createdAt: '2026-02-01T00:00:00.000Z',
        };
        const ops = [...buildFailingOps()];
        await materialiseMigrationPackage(join(baseline.migrationsDir, EXT_SPACE_ID), {
          dirName: '20260201T0000_failing',
          metadata: { ...baseMeta, migrationHash: computeMigrationHash(baseMeta, ops) },
          ops,
        });
      }

      const updateResult = await executeDbUpdate({
        driver: drv,
        adapter: controlAdapter,
        familyInstance,
        contract: appContract,
        mode: 'apply',
        migrations: postgresTargetDescriptor.migrations,
        frameworkComponents: [...frameworkComponents],
        migrationsDir: baseline.migrationsDir,
        targetId: 'postgres',
        extensions: [
          buildExtensionPack({
            contractJson: extContractV2,
            headHash: extContractV2.storage.storageHash,
          }),
        ],
        acceptDataLoss: true,
      });

      expect(updateResult.ok).toBe(false);
      if (updateResult.ok) throw new Error('expected failure');
      expect(updateResult.failure.code).toBe('RUNNER_FAILED');
      expect(updateResult.failure.meta).toMatchObject({ failingSpace: EXT_SPACE_ID });

      const markersAfter = await drv.query<{ space: string; core_hash: string }>(
        'select space, core_hash from prisma_contract.marker order by space',
      );
      expect(markersAfter.rows.find((r) => r.space === 'app')!.core_hash).toBe(appHashBefore);
      expect(markersAfter.rows.find((r) => r.space === EXT_SPACE_ID)!.core_hash).toBe(
        extHashBefore,
      );
    },
    testTimeout,
  );
});

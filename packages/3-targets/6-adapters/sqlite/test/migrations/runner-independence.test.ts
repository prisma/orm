import { mkdtempSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, type MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { materialiseMigrationPackage, readMigrationPackage } from '@internal/migration-tools/io';
import { SqlStorage } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

/**
 * Runner-independence regression (AC6 of TML-3059, extending TML-2512):
 * `migration apply` walks the on-disk app-space migration graph reading
 * only `migration.json` + `ops.json` per package. The contract snapshot
 * store (`migrations/snapshots/`) is authoring/planning surface — apply
 * must succeed even when it is deleted entirely.
 *
 * Builds a two-migration app-space chain (null -> C1 -> C2) the same way
 * `migration plan` would: real on-disk packages via
 * `materialiseMigrationPackage`, real store entries via
 * `writeContractSnapshot`. Reads each package back through
 * `readMigrationPackage` (the same reader `migration apply` uses) and
 * executes it through the real SQLite runner. Deletes
 * `migrations/snapshots/` before reading and applying the second
 * migration, proving both the reader and the runner tolerate its absence.
 *
 * Mirrors the Postgres equivalent at
 * `packages/3-targets/6-adapters/postgres/test/migrations/runner-independence.integration.test.ts`.
 */

const STORAGE_HASH_C1 = '1'.repeat(64);
const STORAGE_HASH_C2 = '2'.repeat(64);

function buildAppContract(version: 1 | 2): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(`runner-independence-v${version}`),
    storage: new SqlStorage({
      storageHash: coreHash(version === 1 ? STORAGE_HASH_C1 : STORAGE_HASH_C2),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
                  email: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
                  ...(version === 2
                    ? {
                        name: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: true },
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

const contractC1 = buildAppContract(1);
const contractC2 = buildAppContract(2);

function buildCreateTableOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'table.user',
      label: 'Create user table',
      operationClass: 'additive',
      target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'user' } },
      precheck: [],
      execute: [
        {
          description: 'create user',
          sql: 'CREATE TABLE "user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL)',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

function buildAddColumnOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'column.user.name',
      label: 'Add name column to user',
      operationClass: 'additive',
      target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'user' } },
      precheck: [],
      execute: [
        {
          description: 'add name column',
          sql: 'ALTER TABLE "user" ADD COLUMN name TEXT',
        },
      ],
      postcheck: [],
    } as unknown as MigrationPlanOperation,
  ];
}

describe('migration apply runner independence from the contract snapshot store - sqlite', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;
  let tmpRoot: string;
  let migrationsDir: string;
  let appMigrationsDir: string;

  afterEach(async () => {
    testDb?.cleanup();
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  });

  it('applies a two-migration chain via the real reader + runner, surviving deletion of migrations/snapshots/', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;

    tmpRoot = mkdtempSync(join(tmpdir(), 'prisma-sqlite-runner-independence-'));
    migrationsDir = join(tmpRoot, 'migrations');
    appMigrationsDir = join(migrationsDir, 'app');
    await mkdir(appMigrationsDir, { recursive: true });

    const pkg1Dir = '20260101T0000_create_user';
    const pkg2Dir = '20260102T0000_add_user_name';

    // Author-time: populate the store the same way `migration plan`
    // would, then materialise the packages (migration.json + ops.json
    // only — the runner never reads the store).
    await writeContractSnapshot(migrationsDir, STORAGE_HASH_C1, {
      contractJson: contractC1,
      contractDts: '// placeholder\nexport {};\n',
    });
    await writeContractSnapshot(migrationsDir, STORAGE_HASH_C2, {
      contractJson: contractC2,
      contractDts: '// placeholder\nexport {};\n',
    });

    const meta1 = {
      from: null,
      to: STORAGE_HASH_C1,
      providedInvariants: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const ops1 = buildCreateTableOps();
    await materialiseMigrationPackage(appMigrationsDir, {
      dirName: pkg1Dir,
      metadata: { ...meta1, migrationHash: computeMigrationHash(meta1, ops1) },
      ops: ops1,
    });

    const meta2 = {
      from: STORAGE_HASH_C1,
      to: STORAGE_HASH_C2,
      providedInvariants: [],
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    const ops2 = buildAddColumnOps();
    await materialiseMigrationPackage(appMigrationsDir, {
      dirName: pkg2Dir,
      metadata: { ...meta2, migrationHash: computeMigrationHash(meta2, ops2) },
      ops: ops2,
    });

    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    // --- Apply migration 1 (store present) ---
    const readPkg1 = await readMigrationPackage(join(appMigrationsDir, pkg1Dir), {
      migrationsDir,
    });
    const plan1 = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contractC1),
      operations:
        readPkg1.ops as unknown as readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
      providedInvariants: [],
    });
    const edge1: AggregateMigrationEdgeRef = {
      dirName: readPkg1.dirName,
      migrationHash: readPkg1.metadata.migrationHash,
      from: readPkg1.metadata.from ?? '',
      to: readPkg1.metadata.to,
      operationCount: readPkg1.ops.length,
    };
    const result1 = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: plan1,
          migrationEdges: [edge1],
          driver,
          destinationContract: contractC1,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!result1.ok) throw new Error(formatRunnerFailure(result1.failure));
    expect(result1.value.perSpaceResults[0]?.value).toMatchObject({ operationsExecuted: 1 });

    const afterFirst = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'user'",
    );
    expect(afterFirst.rows[0]?.cnt).toBe(1);

    // --- Delete the entire contract snapshot store. ---
    await rm(join(migrationsDir, 'snapshots'), { recursive: true, force: true });
    const dirsAfterDelete = await readdir(migrationsDir);
    expect(dirsAfterDelete).not.toContain('snapshots');

    // --- Apply migration 2: read + execute with the store gone. ---
    const readPkg2 = await readMigrationPackage(join(appMigrationsDir, pkg2Dir), {
      migrationsDir,
    });
    // Tolerant read: no store entry means the key is omitted, not an error.
    expect('endContractJson' in readPkg2).toBe(false);

    const plan2 = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: toPlanContractInfo(contractC1),
      destination: toPlanContractInfo(contractC2),
      operations:
        readPkg2.ops as unknown as readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
      providedInvariants: [],
    });
    const edge2: AggregateMigrationEdgeRef = {
      dirName: readPkg2.dirName,
      migrationHash: readPkg2.metadata.migrationHash,
      from: readPkg2.metadata.from ?? '',
      to: readPkg2.metadata.to,
      operationCount: readPkg2.ops.length,
    };
    const result2 = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: plan2,
          migrationEdges: [edge2],
          driver,
          destinationContract: contractC2,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!result2.ok) throw new Error(formatRunnerFailure(result2.failure));
    expect(result2.value.perSpaceResults[0]?.value).toMatchObject({ operationsExecuted: 1 });

    const markerRow = await driver.query<{ core_hash: string }>(
      'SELECT core_hash FROM _prisma_marker WHERE space = ?',
      ['app'],
    );
    expect(markerRow.rows[0]?.core_hash).toBe(STORAGE_HASH_C2);

    const cols = await driver.query<{ name: string }>('PRAGMA table_info("user")');
    expect(cols.rows.map((r) => r.name).sort()).toEqual(['email', 'id', 'name']);

    // A package dir legitimately contains only migration.json + ops.json.
    expect((await readdir(join(appMigrationsDir, pkg2Dir))).sort()).toEqual([
      'migration.json',
      'ops.json',
    ]);
  });
});

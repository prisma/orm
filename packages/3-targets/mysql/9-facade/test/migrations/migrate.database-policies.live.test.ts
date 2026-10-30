import type { MysqlControlDriver } from '@internal/driver-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql, {
  createMigrationPlan,
  type SqlControlFamilyInstance,
} from '@internal/family-sql/control';
import {
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
  type MigrationOperationClass,
  type MigrationPlan,
  type MigrationRunnerResult,
} from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import mysql, { type MysqlPlanTargetDetails } from '@internal/target-mysql/control';
import { ifDefined } from '@internal/utils/defined';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import { frameworkComponents, loadExampleContract } from '../example-contract';
import { controlStack, createAdapter, EVERY_CLASS } from './planner-harness';

const MIGRATE_ONLY: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-forbidden',
  },
};

const RECONCILE_ONLY: DatabasePolicies = {
  change: ['reconcile'],
  dataProtection: {
    dataLoss: 'data-loss-permitted',
    accessWidening: 'access-widening-permitted',
  },
};

const contract = loadExampleContract();
const destination = { storageHash: contract.storage.storageHash };

interface Run {
  readonly plan: MigrationPlan;
  readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
  readonly databasePolicies?: DatabasePolicies;
  readonly expectedDatabasePolicies?: DatabasePolicies;
}

async function withDriver<T>(
  url: string,
  fn: (driver: MysqlControlDriver, family: SqlControlFamilyInstance) => Promise<T>,
): Promise<T> {
  const driver = await mysqlDriver.create(url);
  try {
    return await fn(driver, sql.create(controlStack));
  } finally {
    await driver.close();
  }
}

function execute(
  family: SqlControlFamilyInstance,
  driver: MysqlControlDriver,
  run: Run,
): Promise<MigrationRunnerResult> {
  return mysql.migrations.createRunner(family).execute({
    driver,
    perSpaceOptions: [
      {
        space: 'app',
        driver,
        destinationContract: contract,
        policy: EVERY_CLASS,
        frameworkComponents,
        strictVerification: false,
        ...run,
      },
    ],
  });
}

async function applyContract(
  family: SqlControlFamilyInstance,
  driver: MysqlControlDriver,
  databasePolicies?: DatabasePolicies,
): Promise<void> {
  const planned = mysql.migrations.createPlanner(createAdapter()).plan({
    contract,
    schema: await family.introspect({ driver }),
    policy: EVERY_CLASS,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
  });
  if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
  const migrationEdges = [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: undefined,
      destinationStorageHash: destination.storageHash,
      operationCount: planned.plan.operations.length,
    }),
  ];
  const result = await execute(family, driver, {
    plan: planned.plan,
    migrationEdges,
    ...ifDefined('databasePolicies', databasePolicies),
  });
  result.assertOk();
}

function selfEdgePlan(
  options: { readonly providedInvariants?: readonly string[]; readonly failing?: boolean } = {},
): MigrationPlan {
  const failingOperation = {
    id: 'table.never',
    label: 'Read a table that does not exist',
    operationClass: 'additive' as MigrationOperationClass,
    target: { id: 'mysql', details: { objectType: 'table' as const, name: 'never' } },
    precheck: [],
    execute: [{ description: 'read a missing table', sql: 'SELECT * FROM `missing`' }],
    postcheck: [],
  };
  return createMigrationPlan<MysqlPlanTargetDetails>({
    targetId: 'mysql',
    spaceId: 'app',
    origin: destination,
    destination,
    operations: options.failing ? [failingOperation] : [],
    providedInvariants: options.providedInvariants ?? [],
  });
}

async function recordedPolicies(family: SqlControlFamilyInstance, driver: MysqlControlDriver) {
  return (await family.readMarker({ driver, space: 'app' }))?.meta['policies'];
}

async function ledgerLength(family: SqlControlFamilyInstance, driver: MysqlControlDriver) {
  return (await family.readLedger({ driver, space: 'app' })).length;
}

describe('MySQL database policies', { timeout: timeouts.databaseOperation }, () => {
  it('records the policies with the marker and keeps them through a later run without them', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        await applyContract(family, driver, MIGRATE_ONLY);
        const recorded = await recordedPolicies(family, driver);

        const later = await execute(family, driver, {
          plan: selfEdgePlan({ providedInvariants: ['inv-a'] }),
          migrationEdges: [],
        });

        const marker = await family.readMarker({ driver, space: 'app' });
        expect({
          recorded,
          later: later.ok,
          invariants: marker?.invariants,
          kept: marker?.meta['policies'],
        }).toEqual({
          recorded: MIGRATE_ONLY,
          later: true,
          invariants: ['inv-a'],
          kept: MIGRATE_ONLY,
        });
      }),
    );
  });

  it('writes the marker and no ledger entry for a run with no migrations', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        await applyContract(family, driver);
        const ledgerBefore = await ledgerLength(family, driver);

        const result = await execute(family, driver, {
          plan: selfEdgePlan(),
          migrationEdges: [],
          databasePolicies: MIGRATE_ONLY,
        });

        expect({
          ok: result.ok,
          policies: await recordedPolicies(family, driver),
          ledger: await ledgerLength(family, driver),
        }).toEqual({ ok: true, policies: MIGRATE_ONLY, ledger: ledgerBefore });
      }),
    );
  });

  it('leaves the policies unchanged when the run fails', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        await applyContract(family, driver, MIGRATE_ONLY);

        const result = await execute(family, driver, {
          plan: selfEdgePlan({ failing: true }),
          migrationEdges: [],
          databasePolicies: RECONCILE_ONLY,
        });

        expect({
          code: result.ok ? undefined : result.failure.code,
          policies: await recordedPolicies(family, driver),
        }).toEqual({ code: 'MIGRATION.EXECUTION_FAILED', policies: MIGRATE_ONLY });
      }),
    );
  });

  it('records the policies and writes no ledger entry for a db update that changes nothing', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        await applyContract(family, driver);
        const ledgerBefore = await ledgerLength(family, driver);

        const result = await execute(family, driver, {
          plan: selfEdgePlan(),
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: destination.storageHash,
              destinationStorageHash: destination.storageHash,
              operationCount: 0,
            }),
          ],
          databasePolicies: MIGRATE_ONLY,
        });

        expect({
          ok: result.ok,
          policies: await recordedPolicies(family, driver),
          ledger: await ledgerLength(family, driver),
        }).toEqual({ ok: true, policies: MIGRATE_ONLY, ledger: ledgerBefore });
      }),
    );
  });

  it('fails as a concurrent change when the policies moved after the caller checked them', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        await applyContract(family, driver, MIGRATE_ONLY);

        const result = await execute(family, driver, {
          plan: selfEdgePlan({ providedInvariants: ['inv-a'] }),
          migrationEdges: [],
          databasePolicies: RECONCILE_ONLY,
          expectedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
        });

        expect({
          code: result.ok ? undefined : result.failure.code,
          policies: await recordedPolicies(family, driver),
        }).toEqual({ code: 'MIGRATION.MARKER_CAS_FAILURE', policies: MIGRATE_ONLY });
      }),
    );
  });
});

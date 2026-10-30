import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type DatabasePolicies,
  type MigrationRunnerResult,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { ifDefined } from '@internal/utils/defined';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createLedgerTestPlan,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

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

describe('SqliteMigrationRunner database policies', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;
  let driver: TestDatabase['driver'];

  beforeEach(() => {
    testDb = createTestDatabase();
    driver = testDb.driver;
  });

  afterEach(() => {
    testDb.cleanup();
  });

  function run(
    perSpace: ReadonlyArray<{
      readonly plan: ReturnType<typeof createMigrationPlan<SqlitePlanTargetDetails>>;
      readonly migrationEdges: readonly AggregateMigrationEdgeRef[];
      readonly databasePolicies?: DatabasePolicies;
    }>,
  ): Promise<MigrationRunnerResult> {
    return sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: perSpace.map((entry) => ({
        space: entry.plan.spaceId,
        driver,
        destinationContract: contract,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
        strictVerification: false,
        ...entry,
      })),
    });
  }

  async function applyContract(databasePolicies?: DatabasePolicies): Promise<void> {
    const planned = sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error('expected planner success');
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: await Promise.all(planned.plan.operations),
      providedInvariants: [],
    });
    const result = await run([
      {
        plan,
        migrationEdges: synthEdges(plan),
        ...ifDefined('databasePolicies', databasePolicies),
      },
    ]);
    result.assertOk();
  }

  function selfEdgePlan(providedInvariants: readonly string[] = []) {
    return createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: toPlanContractInfo(contract),
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants,
    });
  }

  async function recordedPolicies(): Promise<unknown> {
    return (await familyInstance.readMarker({ driver, space: APP_SPACE_ID }))?.meta['policies'];
  }

  async function ledgerLength(): Promise<number> {
    return (await familyInstance.readLedger({ driver, space: APP_SPACE_ID })).length;
  }

  it('records the policies with the marker of a first run', async () => {
    await applyContract(MIGRATE_ONLY);

    expect(await recordedPolicies()).toEqual(MIGRATE_ONLY);
  });

  it('leaves the policies when a later run does not set them', async () => {
    await applyContract(MIGRATE_ONLY);

    const result = await run([{ plan: selfEdgePlan(['inv-a']), migrationEdges: [] }]);

    result.assertOk();
    const marker = await familyInstance.readMarker({ driver, space: APP_SPACE_ID });
    expect({ invariants: marker?.invariants, policies: marker?.meta['policies'] }).toEqual({
      invariants: ['inv-a'],
      policies: MIGRATE_ONLY,
    });
  });

  it('writes the marker and no ledger entry for a run with no migrations', async () => {
    await applyContract();
    const ledgerBefore = await ledgerLength();

    const result = await run([
      { plan: selfEdgePlan(), migrationEdges: [], databasePolicies: MIGRATE_ONLY },
    ]);

    result.assertOk();
    expect({ policies: await recordedPolicies(), ledger: await ledgerLength() }).toEqual({
      policies: MIGRATE_ONLY,
      ledger: ledgerBefore,
    });
  });

  it('leaves the policies unchanged when a later space of the same run fails', async () => {
    await applyContract(MIGRATE_ONLY);
    const failing = createLedgerTestPlan({
      destinationHash: contract.storage.storageHash,
      migrationEdges: [],
      operations: [
        {
          id: 'table.never',
          label: 'Failing operation',
          operationClass: 'additive',
          target: { id: 'sqlite', details: { objectType: 'table', name: 'never' } },
          precheck: [{ description: 'always false', sql: 'SELECT 0' }],
          execute: [],
          postcheck: [],
        },
      ],
    });

    const result = await run([
      { plan: selfEdgePlan(), migrationEdges: [], databasePolicies: RECONCILE_ONLY },
      { plan: failing, migrationEdges: synthEdges(failing) },
    ]);

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      meta: { failingSpace: LEDGER_TEST_SPACE_ID },
    });
    expect(await recordedPolicies()).toEqual(MIGRATE_ONLY);
  });
});

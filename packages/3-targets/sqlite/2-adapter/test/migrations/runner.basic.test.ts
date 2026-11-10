import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner - Basic Execution', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('applies an additive plan, creating the table and writing marker and ledger', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const planner = sqliteTargetDescriptor.createPlanner(controlAdapter);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const result = planner.plan({
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
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');

    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: result.plan.spaceId ?? APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(formatRunnerFailure(executeResult.failure));
    }
    expect(executeResult.value.perSpaceResults[0]?.value).toMatchObject({
      operationsPlanned: result.plan.operations.length,
      operationsExecuted: result.plan.operations.length,
    });

    const tableRow = await driver.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type = 'table' AND name = 'user'",
    );
    expect(tableRow.rows[0]!.cnt).toBe(1);

    const markerRow = await driver.query<{ core_hash: string; profile_hash: string }>(
      'SELECT core_hash, profile_hash FROM _prisma_marker WHERE space = ?',
      ['app'],
    );
    expect(markerRow.rows[0]).toMatchObject({
      core_hash: contract.storage.storageHash,
      profile_hash: contract.profileHash,
    });

    const ledgerRow = await driver.query<{ destination_core_hash: string; operations: string }>(
      'SELECT destination_core_hash, operations FROM _prisma_ledger ORDER BY id DESC LIMIT 1',
    );
    expect(ledgerRow.rows[0]).toMatchObject({
      destination_core_hash: contract.storage.storageHash,
    });
    expect(Array.isArray(JSON.parse(ledgerRow.rows[0]!.operations))).toBe(true);
  });

  it('when schema already matches, executes empty plan and still upserts marker and appends ledger', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const planner = sqliteTargetDescriptor.createPlanner(controlAdapter);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);

    const initialPlan = planner.plan({
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
    if (initialPlan.kind !== 'success') throw new Error('expected initial planner success');
    const firstResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: initialPlan.plan.spaceId ?? APP_SPACE_ID,
          plan: initialPlan.plan,
          migrationEdges: synthEdges(initialPlan.plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!firstResult.ok) throw new Error(formatRunnerFailure(firstResult.failure));

    const emptyPlan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [],
      providedInvariants: [],
    });

    const emptyPlanResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: emptyPlan.spaceId ?? APP_SPACE_ID,
          plan: emptyPlan,
          migrationEdges: synthEdges(emptyPlan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });
    if (!emptyPlanResult.ok) throw new Error(formatRunnerFailure(emptyPlanResult.failure));
    expect(emptyPlanResult.value.perSpaceResults[0]?.value).toMatchObject({
      operationsPlanned: 0,
      operationsExecuted: 0,
    });

    const markerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_marker WHERE space = ?',
      ['app'],
    );
    expect(markerCount.rows[0]!.cnt).toBe(1);

    const ledgerCount = await driver.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM _prisma_ledger',
    );
    expect(ledgerCount.rows[0]!.cnt).toBe(2);
  });
});

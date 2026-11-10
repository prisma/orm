import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('PostgresMigrationRunner - Basic Execution', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  describe('when the database is empty', () => {
    it('applies an additive plan, creating the schema and writing the marker and ledger', {
      timeout: testTimeout,
    }, async () => {
      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const runner = postgresTargetDescriptor.createRunner(familyInstance);
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
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }

      const executeResult = await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: result.plan.spaceId ?? APP_SPACE_ID,
            plan: result.plan,
            migrationEdges: synthEdges(result.plan),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });
      expect(executeResult.ok).toBe(true);
      if (executeResult.ok) {
        expect(executeResult.value.perSpaceResults[0]?.value).toMatchObject({
          operationsPlanned: result.plan.operations.length,
          operationsExecuted: result.plan.operations.length,
        });
      }

      const tableRow = await driver!.query<{ exists: boolean }>(
        `select to_regclass('public."user"') is not null as exists`,
      );
      expect(tableRow.rows[0]?.exists).toBe(true);

      const markerRow = await driver!.query<{
        core_hash: string;
        profile_hash: string;
      }>('select core_hash, profile_hash from prisma_contract.marker where space = $1', ['app']);
      expect(markerRow.rows[0]).toMatchObject({
        core_hash: contract.storage.storageHash,
        profile_hash: contract.profileHash,
      });

      const ledgerRow = await driver!.query<{
        destination_core_hash: string;
        operations: unknown;
      }>(
        'select destination_core_hash, operations from prisma_contract.ledger order by id desc limit 1',
      );
      expect(ledgerRow.rows[0]).toMatchObject({
        destination_core_hash: contract.storage.storageHash,
      });
      expect(Array.isArray(ledgerRow.rows[0]?.operations)).toBe(true);
    });

    it('when the database schema already matches the destination contract, executes an empty plan (0 operations) and still upserts the marker and appends a new ledger entry', {
      timeout: testTimeout,
    }, async () => {
      const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
      const runner = postgresTargetDescriptor.createRunner(familyInstance);
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
      if (initialPlan.kind !== 'success') {
        throw new Error('expected initial planner success');
      }
      await runner.execute({
        driver: driver!,
        perSpaceOptions: [
          {
            space: initialPlan.plan.spaceId ?? APP_SPACE_ID,
            plan: initialPlan.plan,
            migrationEdges: synthEdges(initialPlan.plan),
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });

      const emptyPlan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
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
            driver: driver!,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });
      expect(emptyPlanResult.ok).toBe(true);
      if (emptyPlanResult.ok) {
        expect(emptyPlanResult.value.perSpaceResults[0]?.value).toMatchObject({
          operationsPlanned: 0,
          operationsExecuted: 0,
        });
      }

      const markerCount = await driver!.query<{ count: string }>(
        'select count(*)::text as count from prisma_contract.marker where space = $1',
        ['app'],
      );
      expect(markerCount.rows[0]?.count).toBe('1');
      const ledgerCount = await driver!.query<{ count: string }>(
        'select count(*)::text as count from prisma_contract.ledger',
      );
      expect(ledgerCount.rows[0]?.count).toBe('2');
    });
  });
});

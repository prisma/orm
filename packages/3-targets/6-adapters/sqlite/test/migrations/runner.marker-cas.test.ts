import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootstrapSqliteControlTables,
  contract,
  controlAdapter,
  createMigrationPlan,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner marker compare-and-swap', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('names the marker it expected, the marker it found and its destination when the marker moved', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    await bootstrapSqliteControlTables(driver);
    await familyInstance.initMarker({
      driver,
      space: APP_SPACE_ID,
      destination: { storageHash: 'origin', profileHash: 'origin-profile', invariants: [] },
    });
    const planned = sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error('expected planner success');
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: { storageHash: 'origin', profileHash: 'origin-profile' },
      destination: toPlanContractInfo(contract),
      operations: [
        ...(await Promise.all(planned.plan.operations)),
        {
          id: 'marker.move',
          label: 'Another writer moves the marker',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: '_prisma_marker' },
          },
          precheck: [],
          execute: [
            {
              description: 'move the marker',
              sql: "UPDATE _prisma_marker SET core_hash = 'moved' WHERE space = 'app'",
            },
          ],
          postcheck: [
            {
              description: 'the marker moved',
              sql: "SELECT EXISTS (SELECT 1 FROM _prisma_marker WHERE space = 'app' AND core_hash = 'moved')",
            },
          ],
        },
      ],
      providedInvariants: [],
    });

    const result = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
          strictVerification: false,
        },
      ],
    });

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      meta: {
        space: APP_SPACE_ID,
        expectedStorageHash: 'origin',
        foundStorageHash: 'moved',
        destinationStorageHash: contract.storage.storageHash,
      },
    });
  });
});

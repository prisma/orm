import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapPostgresControlTables,
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

describe('PostgresMigrationRunner marker compare-and-swap', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterAll(async () => {
    await driver.close();
    await database.close();
  }, testTimeout);

  it('names the marker it expected, the marker it found and its destination when the marker moved', {
    timeout: testTimeout,
  }, async () => {
    await bootstrapPostgresControlTables(driver);
    await familyInstance.initMarker({
      driver,
      space: APP_SPACE_ID,
      destination: { storageHash: 'origin', profileHash: 'origin-profile', invariants: [] },
    });
    const planned = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error('expected planner success');
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
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
            id: 'postgres',
            details: { schema: 'prisma_contract', objectType: 'table', name: 'marker' },
          },
          precheck: [],
          execute: [
            {
              description: 'move the marker',
              sql: "update prisma_contract.marker set core_hash = 'moved' where space = 'app'",
            },
          ],
          postcheck: [
            {
              description: 'the marker moved',
              sql: "select exists (select 1 from prisma_contract.marker where space = 'app' and core_hash = 'moved')",
            },
          ],
        },
      ],
      providedInvariants: [],
    });

    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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

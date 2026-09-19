import { APP_SPACE_ID } from '@internal/framework-components/control';
import { RenameTableCall } from '@internal/target-postgres/op-factory-call';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('PostgresMigrationRunner - renameTable', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
    driver = undefined;
  }, testTimeout);

  it('fails the precheck instead of skipping the rename when the old and the new table both exist', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('create table "public"."userProfile" (id int primary key)');
    await driver!.query('insert into "public"."userProfile" (id) values (1)');
    await driver!.query('create table "public"."UserProfile" (id int primary key)');
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        await new RenameTableCall('public', 'userProfile', 'UserProfile').toOp(controlAdapter),
      ],
      providedInvariants: [],
    });

    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver: driver!,
          destinationContract: contract,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      summary:
        'Operation renameTable.userProfile failed during precheck: ensure table "UserProfile" does not exist',
      meta: { operationId: 'renameTable.userProfile' },
    });
    const rows = await driver!.query('select id from "public"."userProfile"');
    expect(rows.rows).toEqual([{ id: 1 }]);
  });
});

import { APP_SPACE_ID } from '@internal/framework-components/control';
import { RenameTableCall } from '@internal/target-sqlite/op-factory-call';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

describe('SqliteMigrationRunner - renameTable', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('fails the precheck instead of skipping the rename when the old and the new table both exist', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    await driver.query('CREATE TABLE "profile" (id INTEGER PRIMARY KEY)');
    await driver.query('INSERT INTO "profile" (id) VALUES (1)');
    await driver.query('CREATE TABLE "account" (id INTEGER PRIMARY KEY)');
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [await new RenameTableCall('profile', 'account').toOp(controlAdapter)],
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
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      summary:
        'Operation renameTable.profile failed during precheck: ensure table "account" does not exist',
      meta: { operationId: 'renameTable.profile' },
    });
    const rows = await driver.query('SELECT id FROM "profile"');
    expect(rows.rows).toEqual([{ id: 1 }]);
  });
});

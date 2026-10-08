import { APP_SPACE_ID } from '@internal/framework-components/control';
import { RenameColumnCall } from '@internal/target-sqlite/op-factory-call';
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

describe('SqliteMigrationRunner - renameColumn', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  async function runRename(from: string, to: string) {
    const { driver } = testDb;
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [await new RenameColumnCall('profile', from, to, []).toOp(controlAdapter)],
      providedInvariants: [],
    });
    return sqliteTargetDescriptor.createRunner(familyInstance).execute({
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
  }

  it('fails the precheck instead of skipping the rename when the old and the new column both exist', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    await driver.query('CREATE TABLE "profile" (id INTEGER PRIMARY KEY, name TEXT, fullName TEXT)');
    await driver.query(`INSERT INTO "profile" (id, name, fullName) VALUES (1, 'a', 'b')`);

    const result = await runRename('name', 'fullName');

    expect(result.ok).toBe(false);
    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      summary:
        'Operation renameColumn.profile.name failed during precheck: ensure column "fullName" does not exist on "profile"',
      meta: { operationId: 'renameColumn.profile.name' },
    });
    const rows = await driver.query('SELECT name, fullName FROM "profile"');
    expect(rows.rows).toEqual([{ name: 'a', fullName: 'b' }]);
  });

  it('fails the precheck when a column of the new name exists in another case', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    await driver.query('CREATE TABLE "profile" (id INTEGER PRIMARY KEY, other TEXT, Name TEXT)');

    const result = await runRename('other', 'NAME');

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      meta: { operationId: 'renameColumn.profile.other' },
    });
  });
});

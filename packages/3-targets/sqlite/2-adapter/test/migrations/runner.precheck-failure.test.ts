/**
 * Replaying a migration on a database with no marker that is already ahead of it: the migration adds `nickname TEXT`, and the database already has `nickname` of another type. The postcheck asks for `TEXT`, so the runner runs the operation, whose precheck finds the column already there. The failure names the operation and the check, and gives no explanation of its own, so the CLI can explain it and point to `db sign`.
 */
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { AddColumnCall } from '@internal/target-sqlite/op-factory-call';
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

describe('SqliteMigrationRunner - replay on a database already ahead', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('fails at the precheck, naming the operation and the check', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    await driver.query('CREATE TABLE "user" (id INTEGER PRIMARY KEY, nickname INTEGER)');
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [
        await new AddColumnCall('user', {
          name: 'nickname',
          typeSql: 'TEXT',
          nullable: true,
        }).toOp(controlAdapter),
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
        },
      ],
    });

    const failure = result.assertNotOk();
    expect({ code: failure.code, why: failure.why, meta: failure.meta }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: 'Before operation column.user.nickname runs, it checks: ensure column "nickname" is missing. That check failed: the database already has column "nickname" on "user". The failed apply changed nothing.',
      meta: {
        databaseUnchanged: true,
        failingSpace: 'app',
        failedCheck: {
          operationId: expect.any(String),
          phase: 'precheck',
          description: expect.stringContaining('"nickname"'),
          expectation: { expects: 'absent', object: 'column "nickname" on "user"' },
        },
      },
    });
  });
});

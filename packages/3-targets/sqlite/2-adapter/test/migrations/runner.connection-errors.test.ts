import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlConnectionError } from '@internal/sql-errors';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  contract,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const STEP_SQL = 'CREATE TABLE "lost" (id INTEGER)';

function runStepPlan(driver: TestDatabase['driver']) {
  const plan = createMigrationPlan<SqlitePlanTargetDetails>({
    targetId: 'sqlite',
    spaceId: APP_SPACE_ID,
    origin: null,
    destination: toPlanContractInfo(contract),
    operations: [
      {
        id: 'table.lost',
        label: 'Create lost table',
        summary: 'Creates a table while the connection fails',
        operationClass: 'additive',
        target: { id: 'sqlite', details: { objectType: 'table', name: 'lost' } },
        precheck: [],
        execute: [{ description: 'create lost table', sql: STEP_SQL }],
        postcheck: [],
      },
    ],
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
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      },
    ],
  });
}

describe('SqliteMigrationRunner - connection errors during a step', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it('keeps EXECUTION_FAILED when the database closes mid-step and the cleanup fails too', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const query = driver.query.bind(driver);
    vi.spyOn(driver, 'query').mockImplementation(async (sql, params) => {
      if (sql === STEP_SQL) await driver.close();
      return query(sql, params);
    });

    const failure = (await runStepPlan(driver)).assertNotOk();

    expect(failure.code).toBe('MIGRATION.EXECUTION_FAILED');
    expect(failure.meta).toMatchObject({
      operationId: 'table.lost',
      stepDescription: 'create lost table',
      sql: STEP_SQL,
      connectionLost: true,
      transient: false,
    });
  });

  it('reports a busy database as transient without a lost connection', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const query = driver.query.bind(driver);
    vi.spyOn(driver, 'query').mockImplementation((sql, params) =>
      sql === STEP_SQL
        ? Promise.reject(new SqlConnectionError('database is locked', { transient: true }))
        : query(sql, params),
    );

    const failure = (await runStepPlan(driver)).assertNotOk();

    expect(failure.code).toBe('MIGRATION.EXECUTION_FAILED');
    expect(failure.meta).toMatchObject({
      operationId: 'table.lost',
      connectionLost: false,
      transient: true,
    });
  });
});

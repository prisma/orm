import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contract,
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('PostgresMigrationRunner marker lock', { concurrent: false }, () => {
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

  it('takes the one advisory lock of the marker table that db sign takes', {
    timeout: testTimeout,
  }, async () => {
    const lockParams: (readonly unknown[] | undefined)[] = [];
    const recording: PostgresControlDriver = Object.create(driver, {
      query: {
        value: (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('pg_advisory_xact_lock')) lockParams.push(params);
          return driver.query(sql, params);
        },
      },
    });
    const plan = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (plan.kind !== 'success') throw new Error('expected planner success');

    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: recording,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: plan.plan,
          migrationEdges: synthEdges(plan.plan),
          driver: recording,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(lockParams).toEqual([['prisma_8.contract.marker']]);
  });
});

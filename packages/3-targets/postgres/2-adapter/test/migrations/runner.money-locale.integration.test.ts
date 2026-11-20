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

async function lcMonetary(driver: PostgresControlDriver): Promise<string | undefined> {
  const { rows } = await driver.query<{ lc_monetary: string }>('SHOW lc_monetary');
  return rows[0]?.lc_monetary;
}

describe('PostgresMigrationRunner monetary locale', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await driver.query("SET lc_monetary = 'POSIX'");
  }, testTimeout);

  afterAll(async () => {
    await driver.close();
    await database.close();
  }, testTimeout);

  it('runs the migration with lc_monetary C, set only for its transaction, so a money default in DDL is read in cents', {
    timeout: testTimeout,
  }, async () => {
    const statements: string[] = [];
    const localeAtLock: (string | undefined)[] = [];
    const recording: PostgresControlDriver = Object.create(driver, {
      query: {
        value: async (sql: string, params?: readonly unknown[]) => {
          statements.push(sql);
          if (sql.includes('pg_advisory_xact_lock')) localeAtLock.push(await lcMonetary(driver));
          return driver.query(sql, params);
        },
      },
    });
    const plan = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
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

    expect({
      ok: result.ok,
      opening: statements.slice(0, 2),
      localeAtLock,
      localeAfter: await lcMonetary(driver),
    }).toEqual({
      ok: true,
      opening: ['BEGIN', "SELECT set_config('lc_monetary', 'C', true)"],
      localeAtLock: ['C'],
      localeAfter: 'POSIX',
    });
  });
});

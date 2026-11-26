import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expectNoMarkerOrLedgerWrites } from '../utils/dbAssertions';
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

/** The driver, except that the database reports `serverVersionNumber` as its `server_version_num`, recording every statement it is sent. */
function reportingServerVersion(driver: PostgresControlDriver, serverVersionNumber: number) {
  const sent: string[] = [];
  const reporting = new Proxy(driver, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === 'query') {
        return (sql: string, params?: readonly unknown[]) => {
          sent.push(sql);
          return sql.includes('server_version_num')
            ? Promise.resolve({ rows: [{ server_version_num: serverVersionNumber }] })
            : target.query(sql, params);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { driver: reporting, sent };
}

describe('PostgresMigrationRunner - database capabilities', { concurrent: false }, () => {
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

  it('refuses a server older than the first supported version without sending anything that changes the database', {
    timeout: testTimeout,
  }, async () => {
    const planned = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
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
    if (planned.kind !== 'success') throw new Error('expected planner success');
    const { driver: onPostgres14, sent } = reportingServerVersion(driver!, 140010);

    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: onPostgres14,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned.plan,
          migrationEdges: synthEdges(planned.plan),
          driver: onPostgres14,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    const failure = result.assertNotOk();
    expect({
      code: failure.code,
      message: failure.message,
      databaseUnchanged: failure.meta.databaseUnchanged,
      databaseCapabilitiesNotProvided: failure.meta.databaseCapabilitiesNotProvided,
    }).toEqual({
      code: 'MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED',
      message:
        'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.',
      databaseUnchanged: true,
      databaseCapabilitiesNotProvided: {
        database: 'PostgreSQL',
        findings: [{ kind: 'older-than-supported', databaseVersion: '14.10', oldestSupported: 15 }],
      },
    });
    const userTable = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public."user"') is not null as exists`,
    );
    expect(userTable.rows[0]?.exists).toBe(false);
    await expectNoMarkerOrLedgerWrites(driver!);
    expect(sent).toEqual([
      'BEGIN',
      "SELECT current_setting('server_version_num')::int AS server_version_num",
      'ROLLBACK',
    ]);
  });
});

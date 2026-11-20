import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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

const contract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('money-locale'),
  storage: new SqlStorage({
    storageHash: coreHash('money-locale'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            Price: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                amount: {
                  dataType: 'pg/money',
                  codecId: 'pg/money@1',
                  nullable: false,
                  default: { kind: 'literal', value: '1234.56' },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {},
  extensions: {},
  meta: {},
};

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

  it('sets lc_monetary to C before the migration takes its lock, for its transaction only', {
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

    await driver.query('INSERT INTO "Price" ("id") VALUES (1)');
    const { rows } = await driver.query<{ amount: string }>(
      'SELECT "amount"::numeric::text AS "amount" FROM "Price"',
    );
    const pin = statements.indexOf("SELECT set_config('lc_monetary', $1, true)");
    expect({
      ok: result.ok,
      pinnedBeforeLock:
        pin >= 0 && pin < statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock')),
      localeAtLock,
      localeAfter: await lcMonetary(driver),
      storedDefault: rows,
    }).toEqual({
      ok: true,
      pinnedBeforeLock: true,
      localeAtLock: ['C'],
      localeAfter: 'POSIX',
      storedDefault: [{ amount: '1234.56' }],
    });
  });
});

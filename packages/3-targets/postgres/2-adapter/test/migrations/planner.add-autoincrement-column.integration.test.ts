/**
 * Adding an autoincrement() column through the real planner and runner.
 */
import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const anyClass: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const AUTOINCREMENT: ColumnDefault = { kind: 'function', expression: 'autoincrement()' };

function ordersContract(options: {
  readonly table: string;
  readonly column: string;
  readonly typeText: string;
  readonly numberDefault: ColumnDefault | undefined;
  readonly withColumn?: boolean;
}): Contract<SqlStorage> {
  const hash = JSON.stringify(options);
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hash),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        public: postgresCreateNamespace({
          id: asNamespaceId('public'),
          entries: {
            table: {
              [options.table]: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  ...(options.withColumn === false
                    ? {}
                    : {
                        [options.column]: {
                          dataType: `pg/${options.typeText}`,
                          codecId: `pg/${options.typeText}@1`,
                          nullable: false,
                          ...(options.numberDefault === undefined
                            ? {}
                            : { default: options.numberDefault }),
                        },
                      }),
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
}

/**
 * An `autoincrement()` column added to an existing table is written as SERIAL, SMALLSERIAL or BIGSERIAL, which Postgres stores as integer, smallint or bigint with an owned sequence. The add-column postcheck must check the stored type.
 */
describe('adding an autoincrement() column to an existing table', { concurrent: false }, () => {
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

  function requireDriver(): PostgresControlDriver {
    if (driver === undefined) throw new Error('driver not initialised');
    return driver;
  }

  async function planFor(contract: Contract<SqlStorage>) {
    const schema = await familyInstance.introspect({ driver: requireDriver(), contract });
    const planResult = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema,
      policy: anyClass,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    return planResult.plan;
  }

  async function migrateTo(contract: Contract<SqlStorage>): Promise<readonly string[]> {
    const plan = await planFor(contract);
    const ids = (await Promise.all(plan.operations)).map((operation) => operation.id);
    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: requireDriver(),
      perSpaceOptions: [
        {
          space: plan.spaceId ?? APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver: requireDriver(),
          destinationContract: contract,
          policy: anyClass,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(`runner failed:\n${formatRunnerFailure(result.failure)}`);
    return ids;
  }

  it.each([
    { typeText: 'int2', stored: 'smallint' },
    { typeText: 'int4', stored: 'integer' },
    { typeText: 'int8', stored: 'bigint' },
  ])(
    'adds a $typeText autoincrement() column, checked as $stored',
    { timeout: testTimeout },
    async ({ typeText, stored }) => {
      const shape = { table: 'orders', column: 'number', typeText, numberDefault: AUTOINCREMENT };
      await migrateTo(ordersContract({ ...shape, withColumn: false }));

      const ids = await migrateTo(ordersContract(shape));

      const column = await requireDriver().query<{
        column_type: string;
        serial_sequence: string | null;
      }>(
        `SELECT format_type(atttypid, atttypmod) AS column_type, pg_get_serial_sequence('public.orders', 'number') AS serial_sequence
       FROM pg_attribute WHERE attrelid = 'public.orders'::regclass AND attname = 'number'`,
      );
      expect({ ids, column: column.rows[0] }).toEqual({
        ids: ['column.public.orders.number'],
        column: { column_type: stored, serial_sequence: 'public.orders_number_seq' },
      });
    },
  );
});

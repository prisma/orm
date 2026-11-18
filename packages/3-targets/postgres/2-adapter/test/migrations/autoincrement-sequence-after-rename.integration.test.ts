/**
 * An `autoincrement()` column owns a sequence that keeps its name when the table or column is renamed, and that may have any name on a database Prisma did not create. Changing the column's type, or giving it an `autoincrement()` default again, must find that sequence in the catalog rather than by the name Prisma would give it.
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
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { AlterColumnTypeCall } from '@internal/target-postgres/op-factory-call';
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
                  [options.column]: {
                    dataType: `pg/${options.typeText}`,
                    codecId: `pg/${options.typeText}@1`,
                    nullable: false,
                    ...(options.numberDefault === undefined
                      ? {}
                      : { default: options.numberDefault }),
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
}

describe('the sequence an autoincrement() column owns, under another name', {
  concurrent: false,
}, () => {
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

  async function plannedOperationIds(contract: Contract<SqlStorage>): Promise<readonly string[]> {
    const plan = await planFor(contract);
    return (await Promise.all(plan.operations)).map((operation) => operation.id);
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

  async function migrateTo(contract: Contract<SqlStorage>): Promise<void> {
    const plan = await planFor(contract);
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
  }

  async function ownedSequences(table: string, column: string) {
    const result = await requireDriver().query<{ name: string; data_type: string }>(
      `SELECT s.sequencename AS name, s.data_type::text AS data_type
       FROM pg_depend d
       JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
       JOIN pg_sequences s ON s.schemaname = 'public' AND s.sequencename = c.relname
       JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
       WHERE d.refobjid = $1::regclass AND a.attname = $2 AND d.deptype IN ('a', 'i')`,
      [`public.${table}`, column],
    );
    return result.rows;
  }

  async function renameOrdersToPurchases(): Promise<void> {
    await requireDriver().query('ALTER TABLE public.orders RENAME TO purchases');
    await requireDriver().query(
      'ALTER TABLE public.purchases RENAME CONSTRAINT orders_pkey TO purchases_pkey',
    );
  }

  async function insertedNumber(table: string, column: string): Promise<string> {
    const result = await requireDriver().query<{ value: string }>(
      `INSERT INTO public.${table} (id) VALUES (1) RETURNING ${column}::text AS value`,
    );
    return result.rows[0]?.value ?? '';
  }

  it('widens the sequence of a column whose table was renamed', {
    timeout: testTimeout,
  }, async () => {
    await migrateTo(
      ordersContract({
        table: 'orders',
        column: 'number',
        typeText: 'int4',
        numberDefault: AUTOINCREMENT,
      }),
    );
    await renameOrdersToPurchases();
    await requireDriver().query("SELECT setval('public.orders_number_seq', 2147483647)");
    const widened = ordersContract({
      table: 'purchases',
      column: 'number',
      typeText: 'int8',
      numberDefault: AUTOINCREMENT,
    });

    expect(await plannedOperationIds(widened)).toEqual(['alterType.purchases.number']);
    await migrateTo(widened);

    expect({
      sequences: await ownedSequences('purchases', 'number'),
      inserted: await insertedNumber('purchases', 'number'),
    }).toEqual({
      sequences: [{ name: 'orders_number_seq', data_type: 'bigint' }],
      inserted: '2147483648',
    });
  });

  it('widens the sequence of a column that was renamed', { timeout: testTimeout }, async () => {
    await migrateTo(
      ordersContract({
        table: 'orders',
        column: 'number',
        typeText: 'int4',
        numberDefault: AUTOINCREMENT,
      }),
    );
    await requireDriver().query('ALTER TABLE public.orders RENAME COLUMN number TO serial');
    const widened = ordersContract({
      table: 'orders',
      column: 'serial',
      typeText: 'int8',
      numberDefault: AUTOINCREMENT,
    });

    await migrateTo(widened);

    expect(await ownedSequences('orders', 'serial')).toEqual([
      { name: 'orders_number_seq', data_type: 'bigint' },
    ]);
  });

  it('widens the sequence of an identity column', { timeout: testTimeout }, async () => {
    await requireDriver().query(
      'CREATE TABLE public.orders (id int4 PRIMARY KEY, number int4 GENERATED BY DEFAULT AS IDENTITY NOT NULL)',
    );
    await requireDriver().query(
      'ALTER SEQUENCE public.orders_number_seq RENAME TO orders_identity',
    );
    const widened = ordersContract({
      table: 'orders',
      column: 'number',
      typeText: 'int8',
      numberDefault: AUTOINCREMENT,
    });

    expect(await plannedOperationIds(widened)).toEqual(['alterType.orders.number']);
    await migrateTo(widened);

    expect(await ownedSequences('orders', 'number')).toEqual([
      { name: 'orders_identity', data_type: 'bigint' },
    ]);
  });

  it('gives a renamed column its autoincrement() default back from the sequence it still owns', {
    timeout: testTimeout,
  }, async () => {
    await migrateTo(
      ordersContract({
        table: 'orders',
        column: 'number',
        typeText: 'int4',
        numberDefault: AUTOINCREMENT,
      }),
    );
    await migrateTo(
      ordersContract({
        table: 'orders',
        column: 'number',
        typeText: 'int4',
        numberDefault: undefined,
      }),
    );
    await renameOrdersToPurchases();
    await requireDriver().query("SELECT setval('public.orders_number_seq', 41)");
    const withAutoincrement = ordersContract({
      table: 'purchases',
      column: 'number',
      typeText: 'int4',
      numberDefault: AUTOINCREMENT,
    });

    expect(await plannedOperationIds(withAutoincrement)).toEqual(['setDefault.purchases.number']);
    await migrateTo(withAutoincrement);

    expect({
      sequences: await ownedSequences('purchases', 'number'),
      inserted: await insertedNumber('purchases', 'number'),
    }).toEqual({
      sequences: [{ name: 'orders_number_seq', data_type: 'integer' }],
      inserted: '1',
    });
  });

  it('changes the type of a column whose nextval default reads a sequence it does not own, and leaves the sequence alone', {
    timeout: testTimeout,
  }, async () => {
    await requireDriver().query('CREATE SEQUENCE public.shared_seq AS integer');
    await requireDriver().query(
      "CREATE TABLE public.orders (id int4 PRIMARY KEY, number int4 NOT NULL DEFAULT nextval('public.shared_seq'))",
    );
    const widened = ordersContract({
      table: 'orders',
      column: 'number',
      typeText: 'int8',
      numberDefault: AUTOINCREMENT,
    });

    expect(await plannedOperationIds(widened)).toEqual(['alterType.orders.number']);
    await migrateTo(widened);

    const state = await requireDriver().query<{ column_type: string; sequence_type: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS column_type,
              (SELECT data_type::text FROM pg_sequences WHERE sequencename = 'shared_seq') AS sequence_type
       FROM pg_attribute a WHERE a.attrelid = 'public.orders'::regclass AND a.attname = 'number'`,
    );
    expect(state.rows).toEqual([{ column_type: 'bigint', sequence_type: 'integer' }]);
  });

  it('reads no sequence value to widen, so a role without rights on the sequence can check it', {
    timeout: testTimeout,
  }, async () => {
    await requireDriver().query(
      'CREATE TABLE public.orders (id int4 PRIMARY KEY, number serial NOT NULL)',
    );
    await requireDriver().query('DROP ROLE IF EXISTS sequence_outsider');
    await requireDriver().query('CREATE ROLE sequence_outsider');
    await requireDriver().query('GRANT USAGE ON SCHEMA public TO sequence_outsider');
    await requireDriver().query('GRANT SELECT ON public.orders TO sequence_outsider');
    const op = await new AlterColumnTypeCall({
      schemaName: 'public',
      tableName: 'orders',
      columnName: 'number',
      type: 'int8',
      dataTypes: postgresDataTypes,
      ownsAutoincrementSequence: true,
    }).toOp(controlAdapter);

    await requireDriver().query('SET ROLE sequence_outsider');
    try {
      const results = [];
      for (const step of op.precheck) {
        const result = await requireDriver().query<Record<string, unknown>>(
          step.sql,
          step.params ?? [],
        );
        results.push(Object.values(result.rows[0] ?? {})[0]);
      }
      expect(results).toEqual(op.precheck.map(() => true));
    } finally {
      await requireDriver().query('RESET ROLE');
    }
  });
});

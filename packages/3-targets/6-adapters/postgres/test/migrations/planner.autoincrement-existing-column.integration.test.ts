import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
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

function buildContract(nativeType: string, numberDefault: ColumnDefault | undefined) {
  const hash = `orders-${nativeType}-${numberDefault === undefined ? 'none' : JSON.stringify(numberDefault)}`;
  const contract: Contract<SqlStorage> = {
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
              orders: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  number: {
                    nativeType,
                    codecId: `pg/${nativeType}@1`,
                    nullable: false,
                    ...(numberDefault === undefined ? {} : { default: numberDefault }),
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
  return contract;
}

describe('autoincrement() on an existing integer column', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
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

  function plan(
    contract: Contract<SqlStorage>,
    schema: SqlSchemaIRNode,
    policy: MigrationOperationPolicy,
  ) {
    const planResult = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema,
      policy,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    return planResult.plan;
  }

  async function introspect(contract: Contract<SqlStorage>) {
    return familyInstance.introspect({ driver: driver!, contract });
  }

  async function plannedOperationIds(contract: Contract<SqlStorage>) {
    const operations = await Promise.all(
      plan(contract, await introspect(contract), anyClass).operations,
    );
    return operations.map((operation) => operation.id);
  }

  async function planAndApply(
    contract: Contract<SqlStorage>,
    schema: SqlSchemaIRNode,
    policy: MigrationOperationPolicy,
  ): Promise<void> {
    const migrationPlan = plan(contract, schema, policy);
    const executeResult = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: migrationPlan.spaceId ?? APP_SPACE_ID,
          plan: migrationPlan,
          migrationEdges: synthEdges(migrationPlan),
          driver: driver!,
          destinationContract: contract,
          policy,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }
  }

  async function migrateTo(contract: Contract<SqlStorage>): Promise<void> {
    await planAndApply(contract, await introspect(contract), anyClass);
  }

  async function numberColumn() {
    const result = await driver!.query<{
      column_default: string | null;
      serial_sequence: string | null;
    }>(
      `SELECT column_default, pg_get_serial_sequence('public.orders', 'number') AS serial_sequence
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'number'`,
    );
    return result.rows[0];
  }

  async function insertWithoutNumber(id: number): Promise<number> {
    const result = await driver!.query<{ number: number }>(
      'INSERT INTO public.orders (id) VALUES ($1) RETURNING number::int4 AS number',
      [id],
    );
    return result.rows[0]!.number;
  }

  async function sequenceCount(): Promise<number> {
    const result = await driver!.query<{ count: number }>(
      `SELECT count(*)::int4 AS count FROM pg_class WHERE relkind = 'S' AND relname = 'orders_number_seq'`,
    );
    return result.rows[0]!.count;
  }

  it.each(['int2', 'int4', 'int8'])(
    'attaches a sequence to a %s column that already has rows, and adds it back after removal',
    { timeout: testTimeout },
    async (nativeType) => {
      const withoutDefault = buildContract(nativeType, undefined);
      const withAutoincrement = buildContract(nativeType, AUTOINCREMENT);
      await planAndApply(withoutDefault, emptySchema, INIT_ADDITIVE_POLICY);
      await driver!.query('INSERT INTO public.orders (id, number) VALUES (1, 5), (2, 9)');

      expect(await plannedOperationIds(withAutoincrement)).toEqual(['setDefault.orders.number']);
      await migrateTo(withAutoincrement);

      expect(await numberColumn()).toEqual({
        column_default: "nextval('orders_number_seq'::regclass)",
        serial_sequence: 'public.orders_number_seq',
      });
      expect(await insertWithoutNumber(3)).toBe(10);
      expect(await plannedOperationIds(withAutoincrement)).toEqual([]);

      expect(await plannedOperationIds(withoutDefault)).toEqual(['dropDefault.orders.number']);
      await migrateTo(withoutDefault);
      expect(await numberColumn()).toEqual({
        column_default: null,
        serial_sequence: 'public.orders_number_seq',
      });

      await migrateTo(withAutoincrement);
      expect(await sequenceCount()).toBe(1);
      expect(await insertWithoutNumber(4)).toBe(11);
      expect(await plannedOperationIds(withAutoincrement)).toEqual([]);
    },
  );

  it('replaces a literal default with a sequence', { timeout: testTimeout }, async () => {
    const withLiteral = buildContract('int4', { kind: 'literal', value: 0 });
    const withAutoincrement = buildContract('int4', AUTOINCREMENT);
    await planAndApply(withLiteral, emptySchema, INIT_ADDITIVE_POLICY);
    await driver!.query('INSERT INTO public.orders (id) VALUES (1), (2)');
    await driver!.query('UPDATE public.orders SET number = 7 WHERE id = 2');

    await migrateTo(withAutoincrement);

    expect(await numberColumn()).toEqual({
      column_default: "nextval('orders_number_seq'::regclass)",
      serial_sequence: 'public.orders_number_seq',
    });
    expect(await insertWithoutNumber(3)).toBe(8);
    expect(await plannedOperationIds(withAutoincrement)).toEqual([]);
  });
});

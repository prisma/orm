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
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  number: {
                    dataType: `pg/${nativeType}`,
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
    await apply(plan(contract, schema, policy), contract, policy);
  }

  async function apply(
    migrationPlan: ReturnType<typeof plan>,
    contract: Contract<SqlStorage>,
    policy: MigrationOperationPolicy,
  ): Promise<void> {
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

  it.each([
    { kind: 'table', create: 'CREATE TABLE public.orders_number_seq (id int4)' },
    { kind: 'sequence', create: 'CREATE SEQUENCE public.orders_number_seq' },
  ])(
    'refuses before any step when an unrelated $kind holds the sequence name',
    { timeout: testTimeout },
    async ({ create }) => {
      await planAndApply(buildContract('int4', undefined), emptySchema, INIT_ADDITIVE_POLICY);
      const withAutoincrement = buildContract('int4', AUTOINCREMENT);
      const migrationPlan = plan(withAutoincrement, await introspect(withAutoincrement), anyClass);
      await driver!.query(create);

      await expect(apply(migrationPlan, withAutoincrement, anyClass)).rejects.toThrow(
        'Operation setDefault.orders.number failed during precheck: ensure no relation other than the sequence column "number" owns is named "public"."orders_number_seq" (rename that relation, or write this migration with migration new)',
      );
      expect(await numberColumn()).toEqual({ column_default: null, serial_sequence: null });
    },
  );

  it('widens a sequence left behind by a removed default to the widened column', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(buildContract('int4', undefined), emptySchema, INIT_ADDITIVE_POLICY);
    await migrateTo(buildContract('int4', AUTOINCREMENT));
    await migrateTo(buildContract('int4', undefined));
    await migrateTo(buildContract('int8', undefined));
    await driver!.query('INSERT INTO public.orders (id, number) VALUES (1, 2147483647)');

    await migrateTo(buildContract('int8', AUTOINCREMENT));

    const inserted = await driver!.query<{ number: string }>(
      'INSERT INTO public.orders (id) VALUES (2) RETURNING number::text AS number',
    );
    expect(inserted.rows[0]!.number).toBe('2147483648');
    const sequence = await driver!.query<{ data_type: string; max_value: string }>(
      `SELECT data_type::text AS data_type, max_value::text AS max_value FROM pg_sequences
       WHERE schemaname = 'public' AND sequencename = 'orders_number_seq'`,
    );
    expect(sequence.rows).toEqual([{ data_type: 'bigint', max_value: '9223372036854775807' }]);
  });

  it('starts the sequence at 1 when every existing value is negative', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(buildContract('int4', undefined), emptySchema, INIT_ADDITIVE_POLICY);
    await driver!.query('INSERT INTO public.orders (id, number) VALUES (1, -5), (2, -3)');

    await migrateTo(buildContract('int4', AUTOINCREMENT));

    expect(await insertWithoutNumber(3)).toBe(1);
  });

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

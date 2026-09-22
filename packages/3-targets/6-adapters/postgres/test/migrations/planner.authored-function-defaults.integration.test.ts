import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
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

const additiveAndWidening: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

function buildContract(withDefaults: boolean): Contract<SqlStorage> {
  const id: StorageColumnInput = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: false,
    ...(withDefaults
      ? { default: { kind: 'function', expression: "nextval('orders_seq'::regclass)" } }
      : {}),
  };
  const createdAt: StorageColumnInput = {
    nativeType: 'timestamptz',
    codecId: 'pg/timestamptz-temporal@1',
    nullable: false,
    ...(withDefaults ? { default: { kind: 'function', expression: 'CURRENT_TIMESTAMP' } } : {}),
  };
  const hash = withDefaults ? 'authored-function-defaults' : 'no-defaults';
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
              orders: {
                columns: { id, created_at: createdAt },
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

describe('authored function defaults on Postgres', { concurrent: false }, () => {
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
    await driver.query('CREATE SEQUENCE public.orders_seq');
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

  async function liveColumns() {
    const result = await driver!.query<{
      column_name: string;
      data_type: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'orders' ORDER BY column_name`,
    );
    return result.rows;
  }

  async function replannedOperationIds(contract: Contract<SqlStorage>) {
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const operations = await Promise.all(plan(contract, schema, additiveAndWidening).operations);
    return operations.map((operation) => operation.id);
  }

  const authoredColumns = [
    {
      column_name: 'created_at',
      data_type: 'timestamp with time zone',
      column_default: 'CURRENT_TIMESTAMP',
    },
    { column_name: 'id', data_type: 'integer', column_default: "nextval('orders_seq'::regclass)" },
  ];

  it('creates columns with the authored defaults and then plans no operation', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildContract(true);

    await planAndApply(contract, emptySchema, INIT_ADDITIVE_POLICY);

    expect(await liveColumns()).toEqual(authoredColumns);
    expect(await replannedOperationIds(contract)).toEqual([]);
  });

  it('sets the authored defaults on existing columns and then plans no operation', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(buildContract(false), emptySchema, INIT_ADDITIVE_POLICY);
    const contract = buildContract(true);

    await planAndApply(
      contract,
      await familyInstance.introspect({ driver: driver!, contract }),
      additiveAndWidening,
    );

    expect(await liveColumns()).toEqual(authoredColumns);
    expect(await replannedOperationIds(contract)).toEqual([]);
  });
});

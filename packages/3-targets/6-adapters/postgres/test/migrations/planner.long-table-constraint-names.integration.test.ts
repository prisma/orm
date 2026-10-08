import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
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

const LONG_TABLE = 'a_table_name_long_enough_that_postgres_cuts_its_key_names_x';

interface Keep {
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly foreignKey: boolean;
}

function buildContract(keep: Keep): Contract<SqlStorage> {
  const hash = `long-table-${JSON.stringify(keep)}`;
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
              owner: {
                columns: { id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              [LONG_TABLE]: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  code: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
                  owner_id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                },
                ...(keep.primaryKey ? { primaryKey: { columns: ['id'] } } : {}),
                uniques: keep.unique ? [{ columns: ['code'] }] : [],
                indexes: [],
                foreignKeys: keep.foreignKey
                  ? [
                      {
                        source: {
                          namespaceId: asNamespaceId('public'),
                          tableName: LONG_TABLE,
                          columns: ['owner_id'],
                        },
                        target: {
                          namespaceId: asNamespaceId('public'),
                          tableName: 'owner',
                          columns: ['id'],
                        },
                        constraint: true,
                        index: false,
                      },
                    ]
                  : [],
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

const everything: Keep = { primaryKey: true, unique: true, foreignKey: true };

describe('constraints of a table whose name is over 58 bytes', { concurrent: false }, () => {
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

  function contractSchema(contract: Contract<SqlStorage> | null): SqlSchemaIRNode {
    return postgresTargetDescriptor.migrations.contractToSchema(
      contract,
      frameworkComponents,
    ) as SqlSchemaIRNode;
  }

  async function planAndApply(
    from: Contract<SqlStorage> | null,
    contract: Contract<SqlStorage>,
    policy: MigrationOperationPolicy,
  ): Promise<void> {
    const planResult = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: contractSchema(from),
      policy,
      fromContract: from,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    const migrationPlan = planResult.plan;
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

  async function constraintKinds(): Promise<string[]> {
    const result = await driver!.query<{ contype: string }>(
      `SELECT c.contype FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = $1 ORDER BY c.contype`,
      [LONG_TABLE],
    );
    return result.rows.map((row) => row.contype);
  }

  it.each([
    { constraint: 'primary key', keep: { ...everything, primaryKey: false }, left: ['f', 'u'] },
    { constraint: 'unique constraint', keep: { ...everything, unique: false }, left: ['f', 'p'] },
    { constraint: 'foreign key', keep: { ...everything, foreignKey: false }, left: ['p', 'u'] },
  ])(
    'drops the $constraint the planner created',
    { timeout: testTimeout },
    async ({ keep, left }) => {
      const created = buildContract(everything);
      await planAndApply(null, created, INIT_ADDITIVE_POLICY);
      expect(await constraintKinds()).toEqual(['f', 'p', 'u']);

      await planAndApply(created, buildContract(keep), anyClass);

      expect(await constraintKinds()).toEqual(left);
    },
  );

  it('drops a primary key the planner added to the existing table', {
    timeout: testTimeout,
  }, async () => {
    const withoutKey = buildContract({ ...everything, primaryKey: false });
    const withKey = buildContract(everything);
    await planAndApply(null, withoutKey, INIT_ADDITIVE_POLICY);
    await planAndApply(withoutKey, withKey, anyClass);
    expect(await constraintKinds()).toEqual(['f', 'p', 'u']);

    await planAndApply(withKey, withoutKey, anyClass);

    expect(await constraintKinds()).toEqual(['f', 'u']);
  });
});

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

interface Names {
  readonly primaryKey?: string;
  readonly foreignKey?: string;
}

function buildContract(names: Names): Contract<SqlStorage> {
  const hash = `stated-names-${JSON.stringify(names)}`;
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
              author: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  author_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: {
                  columns: ['id'],
                  ...(names.primaryKey === undefined ? {} : { name: names.primaryKey }),
                },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: asNamespaceId('public'),
                      tableName: 'post',
                      columns: ['author_id'],
                    },
                    target: {
                      namespaceId: asNamespaceId('public'),
                      tableName: 'author',
                      columns: ['id'],
                    },
                    constraint: true,
                    index: false,
                    ...(names.foreignKey === undefined ? {} : { name: names.foreignKey }),
                  },
                ],
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

const unnamed = buildContract({});
const named = buildContract({ primaryKey: 'post_primary', foreignKey: 'post_written_by' });

describe('a contract that starts stating constraint names', { concurrent: false }, () => {
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
    schema: SqlSchemaIRNode = contractSchema(from),
  ): Promise<void> {
    const planResult = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema,
      policy,
      fromContract: from,
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

  async function postConstraintNames(): Promise<string[]> {
    const result = await driver!.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'post' ORDER BY c.conname`,
    );
    return result.rows.map((row) => row.conname);
  }

  it('renames the constraints Prisma 8 created under the derived names', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, unnamed, INIT_ADDITIVE_POLICY);
    expect(await postConstraintNames()).toEqual(['post_author_id_fkey', 'post_pkey']);

    await planAndApply(unnamed, named, anyClass);

    expect(await postConstraintNames()).toEqual(['post_primary', 'post_written_by']);
  });

  it('leaves constraints that already have the stated names, as in a database Prisma 7 built', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, unnamed, INIT_ADDITIVE_POLICY);
    await driver!.query(`
      ALTER TABLE "public"."post" RENAME CONSTRAINT "post_pkey" TO "post_primary";
      ALTER TABLE "public"."post" RENAME CONSTRAINT "post_author_id_fkey" TO "post_written_by";
    `);

    await planAndApply(unnamed, named, anyClass);

    expect(await postConstraintNames()).toEqual(['post_primary', 'post_written_by']);
  });

  it('renames from the names a database created without migrations has, as db update sees them', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, unnamed, INIT_ADDITIVE_POLICY);

    await planAndApply(
      null,
      named,
      anyClass,
      await familyInstance.introspect({ driver: driver!, contract: named }),
    );

    expect(await postConstraintNames()).toEqual(['post_primary', 'post_written_by']);
  });
});

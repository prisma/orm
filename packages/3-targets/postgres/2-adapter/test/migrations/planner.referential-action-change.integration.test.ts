import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { type ReferentialAction, SqlStorage } from '@internal/sql-contract/types';
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

interface Actions {
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

function buildContract(actions: Actions): Contract<SqlStorage> {
  const hash = `referential-actions-${JSON.stringify(actions)}`;
  const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } as const;
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
                columns: { id: int4 },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: { id: int4, author_id: int4 },
                primaryKey: { columns: ['id'] },
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
                    ...actions,
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

const restrict = buildContract({ onDelete: 'restrict', onUpdate: 'restrict' });
const cascade = buildContract({ onDelete: 'cascade', onUpdate: 'cascade' });

describe('a foreign key whose referential actions change', { concurrent: false }, () => {
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

  function plan(
    from: Contract<SqlStorage> | null,
    contract: Contract<SqlStorage>,
    policy: MigrationOperationPolicy,
    schema: SqlSchemaIRNode,
  ) {
    return postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema,
      policy,
      fromContract: from,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  async function planAndApply(
    from: Contract<SqlStorage> | null,
    contract: Contract<SqlStorage>,
    policy: MigrationOperationPolicy,
    schema: SqlSchemaIRNode = contractSchema(from),
  ): Promise<readonly string[]> {
    const planResult = plan(from, contract, policy, schema);
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    const migrationPlan = planResult.plan;
    const operations = await Promise.all(migrationPlan.operations);
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
    return operations.map((operation) => operation.id);
  }

  async function foreignKeyActions() {
    const result = await driver!.query<{
      conname: string;
      confdeltype: string;
      confupdtype: string;
    }>(
      `SELECT c.conname, c.confdeltype, c.confupdtype FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'post' AND c.contype = 'f'`,
    );
    return result.rows;
  }

  async function seedRows(): Promise<void> {
    await driver!.query(`
      INSERT INTO "public"."author" ("id") VALUES (1), (2);
      INSERT INTO "public"."post" ("id", "author_id") VALUES (10, 1), (11, 2);
    `);
  }

  async function introspect(contract: Contract<SqlStorage>): Promise<SqlSchemaIRNode> {
    return familyInstance.introspect({ driver: driver!, contract });
  }

  it('drops and adds the constraint with the new actions on a table with rows', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, restrict, INIT_ADDITIVE_POLICY);
    await seedRows();

    const operationIds = await planAndApply(restrict, cascade, anyClass);

    expect(operationIds).toEqual([
      'dropConstraint.post.post_author_id_fkey',
      'foreignKey.post.post_author_id_fkey',
    ]);
    expect(await foreignKeyActions()).toEqual([
      { conname: 'post_author_id_fkey', confdeltype: 'c', confupdtype: 'c' },
    ]);
    await driver!.query(`DELETE FROM "public"."author" WHERE "id" = 1`);
    const posts = await driver!.query<{ id: number }>(`SELECT "id" FROM "public"."post"`);
    expect(posts.rows).toEqual([{ id: 11 }]);

    const replan = plan(cascade, cascade, anyClass, await introspect(cascade));
    expect(replan.kind === 'success' ? replan.plan.operations : replan).toEqual([]);
  });

  it('plans the same change from the database, as db update does', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, restrict, INIT_ADDITIVE_POLICY);
    await seedRows();

    await planAndApply(null, cascade, anyClass, await introspect(cascade));

    expect(await foreignKeyActions()).toEqual([
      { conname: 'post_author_id_fkey', confdeltype: 'c', confupdtype: 'c' },
    ]);
  });

  it('is refused by db init, which allows only additive changes', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, restrict, INIT_ADDITIVE_POLICY);

    const result = plan(null, cascade, INIT_ADDITIVE_POLICY, await introspect(cascade));

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [{ kind: 'foreignKeyConflict', refusedOperationClass: 'widening' }],
    });
  });
});

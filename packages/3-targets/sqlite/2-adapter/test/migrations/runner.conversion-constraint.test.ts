import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
  withRewordedQueryErrors,
} from './fixtures/runner-fixtures';

const userContract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('conversion-constraint'),
  storage: new SqlStorage({
    storageHash: coreHash('conversion-constraint'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
                email: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [{ columns: ['email'] }],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      }),
    },
  }),
  roots: {},
  domain: applicationDomainOf({
    models: {
      User: {
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/integer@1' } },
          email: { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/text@1' } },
        },
        relations: {},
        storage: {
          table: 'user',
          namespaceId: UNBOUND_NAMESPACE_ID,
          fields: { id: { column: 'id' }, email: { column: 'email' } },
        },
      },
    },
  }),
  capabilities: {},
  extensions: {},
  meta: {},
};

const copyPlan = createMigrationPlan<SqlitePlanTargetDetails>({
  targetId: 'sqlite',
  spaceId: APP_SPACE_ID,
  origin: null,
  destination: toPlanContractInfo(userContract),
  operations: [
    {
      id: 'recreateTable.user',
      label: 'Convert email',
      summary: 'Copies user into the rebuilt table, converting email',
      operationClass: 'additive',
      target: { id: 'sqlite', details: { objectType: 'table', name: 'user' } },
      precheck: [],
      execute: [
        {
          description: 'copy rows into the rebuilt table',
          sql: 'INSERT INTO "_prisma_new_user" (id, email) SELECT id, lower("email") FROM "user"',
          meta: { conversionCopy: { table: 'user', expressions: { email: 'lower("email")' } } },
        },
      ],
      postcheck: [],
    },
  ],
  providedInvariants: [],
});

describe('a SQLite conversion whose result breaks a constraint of the rebuilt table', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  it("names the converted field from the driver's constraint, whatever the error's message", async () => {
    testDb = createTestDatabase();
    await testDb.driver.query('CREATE TABLE "user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL)');
    await testDb.driver.query(
      'CREATE TABLE "_prisma_new_user" (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE)',
    );
    await testDb.driver.query(`INSERT INTO "user" (id, email) VALUES (1, 'A'), (2, 'a')`);
    const driver = withRewordedQueryErrors(testDb.driver);

    const result = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: copyPlan,
          migrationEdges: synthEdges(copyPlan),
          driver,
          destinationContract: userContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok ? undefined : result.failure).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      meta: {
        failedTypeChange: {
          field: {
            kind: 'field',
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            model: 'User',
            field: 'email',
          },
          by: 'conversion',
          reason: 'invalidResult',
          operationIndex: 0,
        },
      },
    });
  });
});

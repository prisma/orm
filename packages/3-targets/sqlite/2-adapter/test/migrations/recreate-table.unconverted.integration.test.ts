import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
} from './fixtures/runner-fixtures';

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const columnTypes = {
  integer: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
  'integer?': { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: true },
  real: { dataType: 'sqlite/real', codecId: 'sqlite/real@1', nullable: false },
  text: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
  'text?': { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: true },
  blob: { dataType: 'sqlite/blob', codecId: 'sqlite/blob@1', nullable: false },
} as const;

type AgeType = keyof typeof columnTypes;

function userContract(age: AgeType): Contract<SqlStorage> {
  const columns = { id: columnTypes.integer, age: columnTypes[age] };
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('recreate-table-unconverted'),
    storage: new SqlStorage({
      storageHash: coreHash(age),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              User: {
                columns,
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
    domain: applicationDomainOf({
      models: {
        User: {
          fields: Object.fromEntries(
            Object.entries(columns).map(([field, column]) => [
              field,
              { nullable: column.nullable, type: { kind: 'scalar', codecId: column.codecId } },
            ]),
          ),
          relations: {},
          storage: {
            table: 'User',
            namespaceId: UNBOUND_NAMESPACE_ID,
            fields: { id: { column: 'id' }, age: { column: 'age' } },
          },
        },
      },
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('a SQLite type change the rebuild copies', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  function plan(from: Contract<SqlStorage> | null, to: Contract<SqlStorage>) {
    const schema =
      from === null
        ? emptySchema
        : sqliteTargetDescriptor.migrations.contractToSchema(from, frameworkComponents);
    const result = createSqliteMigrationPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: ALL_CLASSES,
      fromContract: from,
      origin: planOriginOf(from),
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    return result.plan;
  }

  function execute(planned: ReturnType<typeof plan>, contract: Contract<SqlStorage>) {
    const { driver } = testDb;
    return sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned,
          migrationEdges: synthEdges(planned),
          driver,
          destinationContract: contract,
          policy: ALL_CLASSES,
          frameworkComponents,
        },
      ],
    });
  }

  async function retype(from: AgeType, to: AgeType, values: readonly string[]) {
    testDb = createTestDatabase();
    const origin = userContract(from);
    expect((await execute(plan(null, origin), origin)).ok).toBe(true);
    for (const [index, value] of values.entries()) {
      await testDb.driver.query(`INSERT INTO "User" (id, age) VALUES (${index + 1}, ${value})`);
    }
    const destination = userContract(to);
    return execute(plan(origin, destination), destination);
  }

  const ages = () =>
    testDb.driver.query('SELECT age, typeof(age) AS class FROM "User" ORDER BY id');

  it('keeps every value the new column converts, NULL included', async () => {
    expect([
      (await retype('text', 'integer', [`'12'`])).ok,
      ...(await ages()).rows,
      (await retype('text', 'real', [`'1.5'`, `'2'`])).ok,
      ...(await ages()).rows,
      (await retype('integer', 'text', ['12'])).ok,
      ...(await ages()).rows,
      (await retype('text?', 'integer?', [`'7'`, 'NULL'])).ok,
      ...(await ages()).rows,
    ]).toEqual([
      true,
      { age: 12, class: 'integer' },
      true,
      { age: 1.5, class: 'real' },
      { age: 2, class: 'real' },
      true,
      { age: '12', class: 'text' },
      true,
      { age: 7, class: 'integer' },
      { age: null, class: 'null' },
    ]);
  });

  it('fails on a value the new column cannot convert, naming its field, and changes nothing', async () => {
    const result = await retype('text', 'integer', [`'12'`, `'abc'`]);
    expect(result.ok ? undefined : result.failure).toMatchObject({
      code: 'MIGRATION.POSTCHECK_FAILED',
      message:
        'Operation recreateTable.User failed during postcheck: verify every value of "age" on "User" is stored as INTEGER',
      why: `The value 'abc' of column "age" on "User" is still stored as text, which INTEGER cannot hold. The failed apply changed nothing.`,
      meta: {
        failedTypeChange: {
          field: {
            kind: 'field',
            namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
            model: 'User',
            field: 'age',
          },
          by: 'cast',
          reason: 'value',
          operationIndex: 0,
        },
      },
    });
    expect((await ages()).rows).toEqual([
      { age: '12', class: 'text' },
      { age: 'abc', class: 'text' },
    ]);
    const declared = await testDb.driver.query(
      `SELECT type FROM pragma_table_info('User') WHERE name = 'age'`,
    );
    expect(declared.rows).toEqual([{ type: 'TEXT' }]);
  });

  it('cuts a long value short where it names it', async () => {
    const result = await retype('text', 'integer', [`'${'x'.repeat(60)}'`]);
    expect(result.ok ? undefined : result.failure.why).toBe(
      `The value '${'x'.repeat(39)}… of column "age" on "User" is still stored as text, which INTEGER cannot hold. The failed apply changed nothing.`,
    );
  });

  it('fails for a real column and for a text column as well', async () => {
    const summaryOf = (result: Awaited<ReturnType<typeof retype>>) =>
      result.ok ? undefined : result.failure.message;
    expect([
      summaryOf(await retype('text', 'real', [`'abc'`])),
      summaryOf(await retype('blob', 'text', [`X'00'`])),
    ]).toEqual([
      'Operation recreateTable.User failed during postcheck: verify every value of "age" on "User" is stored as REAL',
      'Operation recreateTable.User failed during postcheck: verify every value of "age" on "User" is stored as TEXT',
    ]);
  });
});

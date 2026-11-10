import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const columnTypes = {
  text: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
  int4: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
  'timestamptz?': {
    dataType: 'pg/timestamptz',
    codecId: 'pg/timestamptz-temporal@1',
    nullable: true,
  },
  'int4?': { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: true },
  'varchar(20)': {
    dataType: 'pg/varchar',
    codecId: 'pg/varchar@1',
    nullable: false,
    typeParams: { length: 20 },
  },
  'varchar(3)': {
    dataType: 'pg/varchar',
    codecId: 'pg/varchar@1',
    nullable: false,
    typeParams: { length: 3 },
  },
  float8: { dataType: 'pg/float8', codecId: 'pg/float8@1', nullable: false },
} as const;

function userContract(age: keyof typeof columnTypes, seed: string): Contract<SqlStorage> {
  const columns = { id: columnTypes.int4, age: columnTypes[age] };
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('alter-column-type-unconverted'),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
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

const textAge = userContract('text', 'a'.repeat(64));
const intAge = userContract('int4', 'b'.repeat(64));

function plan(from: Contract<SqlStorage> | null, to: Contract<SqlStorage>, schema: unknown) {
  const result = createPostgresMigrationPlanner(controlAdapter).plan({
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

describe('a Postgres type change the database casts', { concurrent: false }, () => {
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

  function execute(planned: ReturnType<typeof plan>, contract: Contract<SqlStorage>) {
    return postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned,
          migrationEdges: synthEdges(planned),
          driver: driver!,
          destinationContract: contract,
          policy: ALL_CLASSES,
          frameworkComponents,
        },
      ],
    });
  }

  async function retype(
    ages: readonly (string | null)[],
    from = textAge,
    to = intAge,
  ): ReturnType<typeof execute> {
    expect((await execute(plan(null, from, emptySchema), from)).ok).toBe(true);
    for (const [index, age] of ages.entries()) {
      await driver!.query('INSERT INTO "User" (id, age) VALUES ($1, $2)', [index + 1, age]);
    }
    const schema = postgresTargetDescriptor.migrations.contractToSchema(from, frameworkComponents);
    return execute(plan(from, to, schema), to);
  }

  it('keeps every value the cast converts', { timeout: testTimeout }, async () => {
    expect((await retype(['12', '7'])).ok).toBe(true);
    const rows = await driver!.query<{ age: number }>('SELECT age FROM "User" ORDER BY id');
    expect(rows.rows).toEqual([{ age: 12 }, { age: 7 }]);
  });

  it('fails on a value the cast cannot convert, naming its field, and changes nothing', {
    timeout: testTimeout,
  }, async () => {
    const result = await retype(['12', 'abc']);
    expect(result.ok ? undefined : result.failure).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
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
    const rows = await driver!.query<{ age: string }>('SELECT age FROM "User" ORDER BY id');
    expect(rows.rows).toEqual([{ age: '12' }, { age: 'abc' }]);
  });

  it('cuts a longer text to a shorter varchar, and rounds a number to an integer', {
    timeout: testTimeout,
  }, async () => {
    const cut = await retype(
      ['alice'],
      userContract('varchar(20)', 'e'.repeat(64)),
      userContract('varchar(3)', 'f'.repeat(64)),
    );
    expect(cut.ok).toBe(true);
    expect((await driver!.query('SELECT age FROM "User"')).rows).toEqual([{ age: 'ali' }]);

    await resetDatabase(driver!);
    const rounded = await retype(['2.6'], userContract('float8', '1'.repeat(64)), intAge);
    expect(rounded.ok).toBe(true);
    expect((await driver!.query('SELECT age FROM "User"')).rows).toEqual([{ age: 3 }]);
  });

  it('fails when the database has no cast between the two types, even with no value to cast', {
    timeout: testTimeout,
  }, async () => {
    const result = await retype(
      [null],
      userContract('timestamptz?', 'c'.repeat(64)),
      userContract('int4?', 'd'.repeat(64)),
    );
    expect(result.ok ? undefined : result.failure.meta.failedTypeChange).toMatchObject({
      field: { model: 'User', field: 'age' },
      by: 'cast',
      reason: 'noCast',
    });
  });
});

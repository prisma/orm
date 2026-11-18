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

const DB_UPDATE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };
const optionalText = { ...text, nullable: true };

type Column = typeof int4 | typeof text | typeof optionalText;

function itemContract(
  columns: Readonly<Record<string, Column>>,
  seed: string,
  uniques: readonly string[] = [],
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('required-column-rows'),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Item: {
                columns,
                primaryKey: { columns: ['id'] },
                uniques: uniques.map((column) => ({ columns: [column] })),
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
        Item: {
          fields: Object.fromEntries(
            Object.entries(columns).map(([field, column]) => [
              field,
              { nullable: column.nullable, type: { kind: 'scalar', codecId: column.codecId } },
            ]),
          ),
          relations: {},
          storage: {
            table: 'Item',
            namespaceId: UNBOUND_NAMESPACE_ID,
            fields: Object.fromEntries(Object.keys(columns).map((column) => [column, { column }])),
          },
        },
      },
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const optionalNote = itemContract({ id: int4, note: optionalText }, 'a'.repeat(64));
const requiredNote = itemContract({ id: int4, note: text }, 'b'.repeat(64));
const withCode = itemContract({ id: int4, note: optionalText, code: text }, 'c'.repeat(64), [
  'code',
]);

function plan(from: Contract<SqlStorage> | null, to: Contract<SqlStorage>, schema: unknown) {
  const result = createPostgresMigrationPlanner(controlAdapter).plan({
    contract: to,
    schema,
    policy: DB_UPDATE,
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

describe('a Postgres column that becomes required while rows have no value', {
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
          policy: DB_UPDATE,
          frameworkComponents,
        },
      ],
    });
  }

  async function seeded(notes: readonly (string | null)[]) {
    expect((await execute(plan(null, optionalNote, emptySchema), optionalNote)).ok).toBe(true);
    for (const [index, note] of notes.entries()) {
      await driver!.query('INSERT INTO "Item" (id, note) VALUES ($1, $2)', [index + 1, note]);
    }
  }

  function planFrom(to: Contract<SqlStorage>) {
    const schema = postgresTargetDescriptor.migrations.contractToSchema(
      optionalNote,
      frameworkComponents,
    );
    return execute(plan(optionalNote, to, schema), to);
  }

  const item = asNamespaceId(UNBOUND_NAMESPACE_ID);

  it('counts the rows that hold NULL, names the field, and applies once they hold values', {
    timeout: testTimeout,
  }, async () => {
    await seeded([null, 'a', null, null]);
    const result = await planFrom(requiredNote);
    expect(result.ok ? undefined : result.failure).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: '3 rows of "Item" hold NULL in "note", so it cannot become required.',
      meta: {
        rowsWithoutValue: [
          {
            field: { kind: 'field', namespaceId: item, model: 'Item', field: 'note' },
            reason: 'nullValues',
            rows: 3,
            operationIndex: 0,
          },
        ],
      },
    });

    await driver!.query(`UPDATE "Item" SET note = 'x' WHERE note IS NULL`);
    expect((await planFrom(requiredNote)).ok).toBe(true);
  });

  it('counts the rows a new required column cannot be added to', {
    timeout: testTimeout,
  }, async () => {
    await seeded(['a', 'b']);
    const result = await planFrom(withCode);
    expect(result.ok ? undefined : result.failure).toMatchObject({
      message:
        '"Item" has 2 rows, so the new required column "code" cannot be added: it can be added to an empty table only.',
      meta: {
        rowsWithoutValue: [
          {
            field: { model: 'Item', field: 'code' },
            reason: 'newField',
            rows: 2,
          },
        ],
      },
    });
  });

  it('names every column of the migration that rows have no value for', {
    timeout: testTimeout,
  }, async () => {
    await seeded([null, 'a']);
    const twoNewColumns = itemContract(
      { id: int4, note: text, code: text, slug: text },
      'd'.repeat(64),
      ['code', 'slug'],
    );
    const result = await planFrom(twoNewColumns);
    expect(
      result.ok
        ? undefined
        : result.failure.meta.rowsWithoutValue?.map(({ field, reason, rows }) => [
            field?.kind === 'field' ? field.field : undefined,
            reason,
            rows,
          ]),
    ).toEqual(
      expect.arrayContaining([
        ['code', 'newField', 2],
        ['slug', 'newField', 2],
      ]),
    );
  });
});

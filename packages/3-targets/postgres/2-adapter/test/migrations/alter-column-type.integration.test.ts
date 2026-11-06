import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { CheckConstraint, SqlStorage } from '@internal/sql-contract/types';
import { composeCheckWirePrefix, computeCheckContentHash } from '@internal/sql-schema-ir/naming';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { AlterColumnTypeCall } from '@internal/target-postgres/op-factory-call';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import {
  postgresCreateNamespace,
  postgresRenderCheckExpressions,
} from '@internal/target-postgres/types';
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

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const id = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };
const intList = {
  dataType: 'pg/int4',
  codecId: 'pg/int4@1',
  nullable: false,
  many: { elementNullable: false },
};
const textList = { ...intList, dataType: 'pg/text', codecId: 'pg/text@1' };

function elementChecks(): CheckConstraint[] {
  return postgresRenderCheckExpressions({
    tableName: 'Item',
    columnName: 'tags',
    many: { elementNullable: false },
    memberValues: undefined,
    valueObject: undefined,
  }).map(
    (candidate) =>
      new CheckConstraint({
        naming: {
          kind: 'wire',
          prefix: composeCheckWirePrefix('Item', candidate.columnName, candidate.kind),
          hash: computeCheckContentHash(candidate.expression),
        },
        expression: candidate.expression,
      }),
  );
}

function itemContract(tags: typeof intList | typeof textList, seed: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('alter-column-type'),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Item: {
                columns: { id, tags },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
                checks: elementChecks(),
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

const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };

/** A table whose one check compares two columns, which the plan may retype. */
function pairContract(column: typeof int4 | typeof text, seed: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('alter-column-type'),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              Pair: {
                columns: { id, low: column, high: column },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
                checks: [
                  new CheckConstraint({
                    naming: { kind: 'exact', name: 'pair_order' },
                    expression: '(low < high)',
                  }),
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

const ints = itemContract(intList, 'a'.repeat(64));
const texts = itemContract(textList, 'b'.repeat(64));

function plan(
  from: Contract<SqlStorage> | null,
  to: Contract<SqlStorage>,
  schema: unknown,
  statements: readonly ResolvedMigrationStatement[] = [],
) {
  const result = createPostgresMigrationPlanner(controlAdapter).plan({
    contract: to,
    schema,
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result.plan;
}

describe('a Postgres column type change', { concurrent: false }, () => {
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

  async function execute(planned: ReturnType<typeof plan>, contract: Contract<SqlStorage>) {
    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: planned.spaceId ?? APP_SPACE_ID,
          plan: planned,
          migrationEdges: synthEdges(planned),
          driver: driver!,
          destinationContract: contract,
          policy: ALL_CLASSES,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));
  }

  it('of a list column moves its element check around the alter, and applies', {
    timeout: testTimeout,
  }, async () => {
    await execute(plan(null, ints, emptySchema), ints);
    await driver!.query(`INSERT INTO "Item" (id, tags) VALUES ('a', ARRAY[1, 2])`);

    const planned = plan(
      ints,
      texts,
      postgresTargetDescriptor.migrations.contractToSchema(ints, frameworkComponents),
    );
    const labels = (await Promise.all(planned.operations)).map(({ label }) => label);
    expect(labels).toEqual([
      expect.stringMatching(/^Drop check constraint "Item_tags_elem_not_null_\w+" on "Item"$/),
      'Alter type of "Item"."tags" to text[]',
      expect.stringMatching(/^Add check constraint "Item_tags_elem_not_null_\w+" on "Item"$/),
    ]);
    await execute(planned, texts);

    const rows = await driver!.query<{ tags: string[] }>(
      `SELECT array_to_json(tags) AS tags FROM "Item"`,
    );
    expect(rows.rows).toEqual([{ tags: ['1', '2'] }]);
    await expect(
      driver!.query(`INSERT INTO "Item" (id, tags) VALUES ('b', ARRAY['x', NULL])`),
    ).rejects.toThrow(/check constraint/);
  });

  it('of two columns one check names drops the check once before both alters, and adds it once after', {
    timeout: testTimeout,
  }, async () => {
    const intPair = pairContract(int4, 'c'.repeat(64));
    const textPair = pairContract(text, 'd'.repeat(64));
    await execute(plan(null, intPair, emptySchema), intPair);
    await driver!.query(`INSERT INTO "Pair" (id, low, high) VALUES ('a', 1, 2)`);

    const planned = plan(
      intPair,
      textPair,
      postgresTargetDescriptor.migrations.contractToSchema(intPair, frameworkComponents),
    );
    const labels = (await Promise.all(planned.operations)).map(({ label }) => label);
    expect(labels).toEqual([
      'Drop check constraint "pair_order" on "Pair"',
      expect.stringMatching(/^Alter type of "Pair"\."(low|high)" to text$/),
      expect.stringMatching(/^Alter type of "Pair"\."(low|high)" to text$/),
      'Add check constraint "pair_order" on "Pair"',
    ]);
    await execute(planned, textPair);

    await expect(
      driver!.query(`INSERT INTO "Pair" (id, low, high) VALUES ('b', 'z', 'a')`),
    ).rejects.toThrow(/pair_order/);
  });

  it('of a list column a convert names puts the same checks around the converted alter', () => {
    const convert: ResolvedMigrationStatement = {
      kind: 'convert',
      entity: 'field',
      field: { namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), model: 'Item', field: 'tags' },
    };
    const rendered = plan(
      ints,
      texts,
      postgresTargetDescriptor.migrations.contractToSchema(ints, frameworkComponents),
      [convert],
    ).renderTypeScript((specifier) => specifier);
    const order = ['this.dropCheckConstraint', 'this.alterColumnType', 'this.addCheckConstraint'];
    expect(order.map((call) => rendered.indexOf(call))).toEqual(
      [...order.map((call) => rendered.indexOf(call))].sort((a, b) => a - b),
    );
    expect(order.every((call) => rendered.includes(call))).toBe(true);
  });

  it('to an enum in public written with its schema checks the type as format_type prints it', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE "Mood" AS ENUM ('happy', 'sad')`);
    await driver!.query(`CREATE TABLE "Person" (id text PRIMARY KEY, mood text)`);
    await driver!.query(`INSERT INTO "Person" VALUES ('a', 'happy')`);
    const op = await new AlterColumnTypeCall({
      ownsAutoincrementSequence: false,
      schemaName: UNBOUND_NAMESPACE_ID,
      tableName: 'Person',
      columnName: 'mood',
      type: '"public"."Mood"',
      using: { kind: 'sql', sql: '"mood"::"Mood"' },
      dataTypes: postgresDataTypes,
    }).toOp(controlAdapter);

    for (const step of op.execute) await driver!.query(step.sql);
    const [postcheck] = op.postcheck;
    const checked = await driver!.query<{ result: boolean }>(
      postcheck?.sql ?? '',
      postcheck?.params ?? [],
    );
    expect(checked.rows).toEqual([{ result: true }]);
  });
});

/**
 * The SQLite planner fills value object fields that become required: with `--backfill`, a
 * `fillStoredKey` whose value the user writes in `migration.ts`, and in `db update`, a temporary
 * value, in single objects, lists of them and nested value objects.
 */
import type { Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import {
  createMigrationPlan,
  INIT_ADDITIVE_POLICY,
  type SqlMigrationPlan,
} from '@internal/family-sql/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  type ValueObjectNode,
} from '@internal/sql-contract-ts/contract-builder';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import { FillStoredKeyCall } from '@internal/target-sqlite/op-factory-call';
import sqlitePack from '@internal/target-sqlite/pack';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const codecLookup = createSqliteBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(sqliteDataTypes);

const DB_UPDATE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};
const MIGRATION_PLAN: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const text = { codecId: 'sqlite/text@1' } as const;
const jsonb = { codecId: 'sqlite/json@1' } as const;

/** `Place` holds a `GeoPoint` in `location`, a list of them in `stops`, and an `Address` whose `point` is a `GeoPoint`. */
function placeContract(country: 'absent' | 'optional' | 'required'): Contract<SqlStorage> {
  const geoFields: ValueObjectNode['fields'] = [
    { fieldName: 'lat', descriptor: text, nullable: false },
    ...(country === 'absent'
      ? []
      : [{ fieldName: 'country', descriptor: text, nullable: country === 'optional' }]),
  ];
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: sqlitePack,
      createNamespace: sqliteCreateNamespace,
      models: [
        {
          modelName: 'Place',
          tableName: 'place',
          fields: [
            { fieldName: 'id', columnName: 'id', descriptor: text, nullable: false },
            {
              fieldName: 'location',
              columnName: 'location',
              valueObjectName: 'GeoPoint',
              descriptor: jsonb,
              nullable: true,
            },
            {
              fieldName: 'stops',
              columnName: 'stops',
              valueObjectName: 'GeoPoint',
              descriptor: jsonb,
              nullable: true,
              many: true,
            },
            {
              fieldName: 'address',
              columnName: 'address',
              valueObjectName: 'Address',
              descriptor: jsonb,
              nullable: true,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
      valueObjects: [
        { name: 'GeoPoint', fields: geoFields },
        {
          name: 'Address',
          fields: [
            { fieldName: 'street', descriptor: text, nullable: false },
            { fieldName: 'point', valueObjectName: 'GeoPoint', nullable: false },
          ],
        },
      ],
    },
    codecLookup,
    dataTypeLookup,
  );
}

const backfill: ResolvedMigrationStatement = {
  kind: 'backfill',
  entity: 'valueObjectField',
  field: {
    namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
    valueObject: 'GeoPoint',
    field: 'country',
  },
};

const FILL_CALL =
  /this\.fillStoredKey\(\{ table: "([^"]*)", column: "([^"]*)", path: "([^"]*)", value: placeholder\("GeoPoint\.country:value"\), codecRef: \{ codecId: "sqlite\/text@1" \} \}\)/g;

describe('SQLite planner, value object field fills', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[],
    policy: MigrationOperationPolicy,
  ) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: testDb.driver, contract: from });
    const result = createSqliteMigrationPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: from === null ? INIT_ADDITIVE_POLICY : policy,
      fromContract: from,
      origin: from === null ? null : planOriginOf(from),
      statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    return result;
  }

  async function apply(
    migration: SqlMigrationPlan<SqlitePlanTargetDetails>,
    contract: Contract<SqlStorage>,
  ) {
    const { driver } = testDb;
    const executed = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: migration,
          migrationEdges: synthEdges(migration),
          driver,
          destinationContract: contract,
          policy: MIGRATION_PLAN,
          frameworkComponents,
        },
      ],
    });
    if (!executed.ok) throw new Error(formatRunnerFailure(executed.failure));
  }

  async function start(contract: Contract<SqlStorage>, country: string): Promise<void> {
    await apply((await plan(null, contract, [], INIT_ADDITIVE_POLICY)).plan, contract);
    await testDb.driver.query(
      `INSERT INTO "place" (id, location, stops, address) VALUES
        ('1', '{"lat": "1"${country}}', '[{"lat": "3"}, {"lat": "5"${country}}]', '{"street": "Main", "point": {"lat": "7"}}'),
        ('2', NULL, '[]', NULL)`,
    );
  }

  async function places(): Promise<unknown[]> {
    const { rows } = await testDb.driver.query<Record<string, string | null>>(
      'SELECT id, location, stops, address FROM "place" ORDER BY id',
    );
    return rows.map(({ id, location, stops, address }) => ({
      id,
      location: location === null || location === undefined ? null : JSON.parse(location),
      stops: stops === null || stops === undefined ? null : JSON.parse(stops),
      address: address === null || address === undefined ? null : JSON.parse(address),
    }));
  }

  /** The kinds of a plan's operations, with `unfilled` for one whose value the user has not written. */
  async function operationKinds(
    migration: SqlMigrationPlan<SqlitePlanTargetDetails>,
  ): Promise<readonly string[]> {
    const settled = await Promise.allSettled(migration.operations);
    return settled.map((entry) =>
      entry.status === 'fulfilled' ? (entry.value.id.split('.')[0] ?? '') : 'unfilled',
    );
  }

  /** The plan its `migration.ts` emits once the user writes `"NZ"` for the placeholder. */
  async function filledWithNz(
    result: Awaited<ReturnType<typeof plan>>,
    from: Contract<SqlStorage>,
    to: Contract<SqlStorage>,
  ): Promise<SqlMigrationPlan<SqlitePlanTargetDetails>> {
    const fills = [...result.plan.renderTypeScript((specifier) => specifier).matchAll(FILL_CALL)];
    const settled = await Promise.allSettled(result.plan.operations);
    let fill = 0;
    const operations = await Promise.all(
      settled.map((entry) => {
        if (entry.status === 'fulfilled') return entry.value;
        const [, table = '', column = '', path = ''] = fills[fill++] ?? [];
        return new FillStoredKeyCall(table, column, path, 'NZ').toOp();
      }),
    );
    expect(fill).toBe(fills.length);
    return createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: toPlanContractInfo(from),
      destination: toPlanContractInfo(to),
      operations,
      providedInvariants: [],
    });
  }

  it('fills a new required field with the value written for --backfill', async () => {
    const from = placeContract('absent');
    const to = placeContract('required');
    await start(from, '');

    const result = await plan(from, to, [backfill], MIGRATION_PLAN);

    expect(await operationKinds(result.plan)).toEqual(['unfilled', 'unfilled', 'unfilled']);
    expect(result.appliedStatements).toEqual([
      { statement: backfill, operationIndexes: [0, 1, 2] },
    ]);
    await apply(await filledWithNz(result, from, to), to);
    expect(await places()).toEqual([
      {
        id: '1',
        location: { lat: '1', country: 'NZ' },
        stops: [
          { lat: '3', country: 'NZ' },
          { lat: '5', country: 'NZ' },
        ],
        address: { street: 'Main', point: { lat: '7', country: 'NZ' } },
      },
      { id: '2', location: null, stops: [], address: null },
    ]);
  });

  it('fills an optional field made required where it is JSON null, and keeps a value it holds', async () => {
    const from = placeContract('optional');
    const to = placeContract('required');
    await start(from, ', "country": null');
    await testDb.driver.query(
      `UPDATE "place" SET address = '{"street": "Main", "point": {"lat": "7", "country": "AU"}}' WHERE id = '1'`,
    );

    const result = await plan(from, to, [backfill], MIGRATION_PLAN);
    await apply(await filledWithNz(result, from, to), to);

    expect((await places())[0]).toMatchObject({
      location: { lat: '1', country: 'NZ' },
      stops: [
        { lat: '3', country: 'NZ' },
        { lat: '5', country: 'NZ' },
      ],
      address: { point: { lat: '7', country: 'AU' } },
    });
  });

  it('fills a new required field with a temporary value in db update', async () => {
    const from = placeContract('absent');
    const to = placeContract('required');
    await start(from, '');

    const result = await plan(from, to, [], DB_UPDATE);
    await apply(result.plan, to);

    expect(result.temporaryValues.map(({ subject, value }) => ({ subject, value }))).toEqual(
      [0, 1, 2].map(() => ({
        subject: { kind: 'valueObjectField', ...backfill.field },
        value: '""',
      })),
    );
    expect((await places())[0]).toEqual({
      id: '1',
      location: { lat: '1', country: '' },
      stops: [
        { lat: '3', country: '' },
        { lat: '5', country: '' },
      ],
      address: { street: 'Main', point: { lat: '7', country: '' } },
    });
  });
});

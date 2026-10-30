/**
 * The SQLite planner rewrites the keys of value object fields that change: a renamed field's key
 * is renamed and a removed field's key is removed, in single objects, lists of them and nested
 * value objects.
 */
import type { Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
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
import sqlitePack from '@internal/target-sqlite/pack';
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
} from './fixtures/runner-fixtures';

const codecLookup = createSqliteBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(sqliteDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'sqlite/text@1' } as const;
const jsonb = { codecId: 'sqlite/json@1' } as const;

function scalars(...names: readonly string[]): ValueObjectNode['fields'] {
  return names.map((fieldName) => ({ fieldName, descriptor: text, nullable: false }));
}

/** `Place` holds a `GeoPoint` in `location`, a list of them in `stops`, and an `Address` whose `pointField` is a `GeoPoint`. */
function placeContract(geoFields: readonly string[], pointField = 'point'): Contract<SqlStorage> {
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
        { name: 'GeoPoint', fields: scalars(...geoFields) },
        {
          name: 'Address',
          fields: [
            ...scalars('street'),
            { fieldName: pointField, valueObjectName: 'GeoPoint', nullable: false },
          ],
        },
      ],
    },
    codecLookup,
    dataTypeLookup,
  );
}

function rename(valueObject: string, from: string, to: string): ResolvedMigrationStatement {
  const namespaceId = asNamespaceId(UNBOUND_NAMESPACE_ID);
  return {
    kind: 'rename',
    entity: 'valueObjectField',
    from: { namespaceId, valueObject, field: from },
    to: { namespaceId, valueObject, field: to },
  };
}

describe('SQLite planner, value object field keys', { timeout: timeouts.databaseOperation }, () => {
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
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: testDb.driver, contract: from });
    return sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: from === null ? INIT_ADDITIVE_POLICY : FULL_POLICY,
      fromContract: from,
      origin: from === null ? null : planOriginOf(from),
      statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  async function apply(result: Awaited<ReturnType<typeof plan>>, contract: Contract<SqlStorage>) {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const { driver } = testDb;
    const executed = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver,
          destinationContract: contract,
          policy: FULL_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executed.ok) throw new Error(formatRunnerFailure(executed.failure));
  }

  async function start(contract: Contract<SqlStorage>): Promise<void> {
    await apply(await plan(null, contract), contract);
    await testDb.driver.query(
      `INSERT INTO "place" (id, location, stops, address) VALUES
        ('1', '{"lat": "1", "lng": "2"}', '[{"lat": "3", "lng": "4"}, {"lat": "5", "lng": "6"}]', '{"street": "Main", "point": {"lat": "7", "lng": "8"}}'),
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

  async function operationKinds(
    result: Awaited<ReturnType<typeof plan>>,
  ): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  it('renames a key in single objects, lists and nested objects', async () => {
    const from = placeContract(['lat', 'lng']);
    const to = placeContract(['latitude', 'lng']);
    await start(from);
    const statement = rename('GeoPoint', 'lat', 'latitude');

    const result = await plan(from, to, [statement]);

    expect(await operationKinds(result)).toEqual([
      'renameStoredKey',
      'renameStoredKey',
      'renameStoredKey',
    ]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [0, 1, 2] },
    ]);
    await apply(result, to);
    expect(await places()).toEqual([
      {
        id: '1',
        location: { latitude: '1', lng: '2' },
        stops: [
          { latitude: '3', lng: '4' },
          { latitude: '5', lng: '6' },
        ],
        address: { street: 'Main', point: { latitude: '7', lng: '8' } },
      },
      { id: '2', location: null, stops: [], address: null },
    ]);
  });

  it('renames an outer key before an inner one in the same plan', async () => {
    const from = placeContract(['lat', 'lng']);
    const to = placeContract(['latitude', 'lng'], 'location');
    await start(from);

    await apply(
      await plan(from, to, [
        rename('GeoPoint', 'lat', 'latitude'),
        rename('Address', 'point', 'location'),
      ]),
      to,
    );

    expect((await places())[0]).toMatchObject({
      address: { street: 'Main', location: { latitude: '7', lng: '8' } },
    });
  });

  it('removes a key the destination lacks, and asks about it as the value object field', async () => {
    const from = placeContract(['lat', 'lng']);
    const to = placeContract(['lat']);
    await start(from);

    const result = await plan(from, to);

    expect(
      result.kind === 'success' &&
        new Set(result.dataLoss.map(({ subject }) => JSON.stringify(subject))),
    ).toEqual(
      new Set([
        JSON.stringify({
          kind: 'valueObjectField',
          namespaceId: UNBOUND_NAMESPACE_ID,
          valueObject: 'GeoPoint',
          field: 'lng',
        }),
      ]),
    );
    await apply(result, to);
    expect(await places()).toEqual([
      {
        id: '1',
        location: { lat: '1' },
        stops: [{ lat: '3' }, { lat: '5' }],
        address: { street: 'Main', point: { lat: '7' } },
      },
      { id: '2', location: null, stops: [], address: null },
    ]);
  });
});

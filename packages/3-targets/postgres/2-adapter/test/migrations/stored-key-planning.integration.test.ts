/**
 * The Postgres planner rewrites the keys of value object fields that change: a renamed field's key
 * is renamed and a removed field's key is removed, in single objects, lists of them and nested
 * value objects, between the drop of the old shape check and the creation of the new one, which
 * then accepts every row.
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
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  type ValueObjectNode,
} from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
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

const codecLookup = createPostgresBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'pg/text@1' } as const;
const jsonb = { codecId: 'pg/jsonb@1' } as const;

function scalars(...names: readonly string[]): ValueObjectNode['fields'] {
  return names.map((fieldName) => ({ fieldName, descriptor: text, nullable: false }));
}

/** `Place` holds a `GeoPoint` in `location`, a list of them in `stops`, and an `Address` whose `pointField` is a `GeoPoint`. */
function placeContract(geoFields: readonly string[], pointField = 'point'): Contract<SqlStorage> {
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
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
  const namespaceId = asNamespaceId('public');
  return {
    kind: 'rename',
    entity: 'valueObjectField',
    from: { namespaceId, valueObject, field: from },
    to: { namespaceId, valueObject, field: to },
  };
}

describe('Postgres planner, value object field keys', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

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
  }, testTimeout);

  const planner = () => postgresTargetDescriptor.createPlanner(controlAdapter);

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null ? emptySchema : await familyInstance.introspect({ driver, contract: from });
    return planner().plan({
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
    const executed = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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
    await driver.query(
      `insert into "place" (id, location, stops, address) values
        ('1', '{"lat": "1", "lng": "2"}', '[{"lat": "3", "lng": "4"}, {"lat": "5", "lng": "6"}]', '{"street": "Main", "point": {"lat": "7", "lng": "8"}}'),
        ('2', null, '[]', null)`,
    );
  }

  async function places(): Promise<unknown[]> {
    return (await driver.query('select id, location, stops, address from "place" order by id'))
      .rows;
  }

  async function operationKinds(
    result: Awaited<ReturnType<typeof plan>>,
  ): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  it('renames a key in single objects, lists and nested objects, between the check drop and creation', {
    timeout: testTimeout,
  }, async () => {
    const from = placeContract(['lat', 'lng']);
    const to = placeContract(['latitude', 'lng']);
    await start(from);
    const statement = rename('GeoPoint', 'lat', 'latitude');

    const result = await plan(from, to, [statement]);

    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'dropCheckConstraint',
      'dropCheckConstraint',
      'renameStoredKey',
      'renameStoredKey',
      'renameStoredKey',
      'checkConstraint',
      'checkConstraint',
      'checkConstraint',
    ]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [3, 4, 5] },
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
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('renames an outer key before an inner one in the same plan', {
    timeout: testTimeout,
  }, async () => {
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

  it('removes a key the destination lacks, and asks about it as the value object field', {
    timeout: testTimeout,
  }, async () => {
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
          namespaceId: 'public',
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

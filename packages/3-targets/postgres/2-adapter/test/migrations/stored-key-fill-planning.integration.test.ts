/**
 * The Postgres planner fills value object fields that become required: with `--backfill`, a
 * `fillStoredKey` whose value the user writes in `migration.ts`, and in `db update`, a temporary
 * value. The fills sit between the drop of the old shape check and the creation of the new one,
 * which then accepts every row.
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
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  type ValueObjectNode,
} from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { FillStoredKeyCall } from '@internal/target-postgres/op-factory-call';
import postgresPack from '@internal/target-postgres/pack';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
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
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const codecLookup = createPostgresBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);

const DB_UPDATE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};
const MIGRATION_PLAN: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const text = { codecId: 'pg/text@1' } as const;
const jsonb = { codecId: 'pg/jsonb@1' } as const;

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
  field: { namespaceId: asNamespaceId('public'), valueObject: 'GeoPoint', field: 'country' },
};

const FILL_CALL =
  /this\.fillStoredKey\(\{ schema: "([^"]*)", table: "([^"]*)", column: "([^"]*)", path: "([^"]*)", value: placeholder\("GeoPoint\.country:value"\), codecRef: \{ codecId: "pg\/text@1" \} \}\)/g;

describe('Postgres planner, value object field fills', { concurrent: false }, () => {
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

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[],
    policy: MigrationOperationPolicy,
  ) {
    const schema =
      from === null ? emptySchema : await familyInstance.introspect({ driver, contract: from });
    const result = createPostgresMigrationPlanner(controlAdapter).plan({
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
    migration: SqlMigrationPlan<PostgresPlanTargetDetails>,
    contract: Contract<SqlStorage>,
  ) {
    const executed = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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
    await driver.query(
      `insert into "place" (id, location, stops, address) values
        ('1', '{"lat": "1"${country}}', '[{"lat": "3"}, {"lat": "5"${country}}]', '{"street": "Main", "point": {"lat": "7"}}'),
        ('2', null, '[]', null)`,
    );
  }

  async function places(): Promise<unknown[]> {
    return (await driver.query('select id, location, stops, address from "place" order by id'))
      .rows;
  }

  /** The kinds of a plan's operations, with `unfilled` for one whose value the user has not written. */
  async function operationKinds(
    migration: SqlMigrationPlan<PostgresPlanTargetDetails>,
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
  ): Promise<SqlMigrationPlan<PostgresPlanTargetDetails>> {
    const fills = [...result.plan.renderTypeScript((specifier) => specifier).matchAll(FILL_CALL)];
    const settled = await Promise.allSettled(result.plan.operations);
    let fill = 0;
    const operations = await Promise.all(
      settled.map((entry) => {
        if (entry.status === 'fulfilled') return entry.value;
        const [, schema = '', table = '', column = '', path = ''] = fills[fill++] ?? [];
        return new FillStoredKeyCall(schema, table, column, path, 'NZ').toOp();
      }),
    );
    expect(fill).toBe(fills.length);
    return createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: toPlanContractInfo(from),
      destination: toPlanContractInfo(to),
      operations,
      providedInvariants: [],
    });
  }

  it('fills a new required field with the value written for --backfill, between the check drop and creation', {
    timeout: testTimeout,
  }, async () => {
    const from = placeContract('absent');
    const to = placeContract('required');
    await start(from, '');

    const result = await plan(from, to, [backfill], MIGRATION_PLAN);

    expect(await operationKinds(result.plan)).toEqual([
      'dropCheckConstraint',
      'dropCheckConstraint',
      'dropCheckConstraint',
      'unfilled',
      'unfilled',
      'unfilled',
      'checkConstraint',
      'checkConstraint',
      'checkConstraint',
    ]);
    expect(result.appliedStatements).toEqual([
      { statement: backfill, operationIndexes: [3, 4, 5] },
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
    expect(await operationKinds((await plan(to, to, [], MIGRATION_PLAN)).plan)).toEqual([]);
  });

  it('fills an optional field made required where it is JSON null, and keeps a value it holds', {
    timeout: testTimeout,
  }, async () => {
    const from = placeContract('optional');
    const to = placeContract('required');
    await start(from, ', "country": null');
    await driver.query(
      `update "place" set address = '{"street": "Main", "point": {"lat": "7", "country": "AU"}}' where id = '1'`,
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

  it('fills a new required field with a temporary value in db update', {
    timeout: testTimeout,
  }, async () => {
    const from = placeContract('absent');
    const to = placeContract('required');
    await start(from, '');

    const result = await plan(from, to, [], DB_UPDATE);
    await apply(result.plan, to);

    expect(result.temporaryValues.map(({ subject, value }) => ({ subject, value }))).toEqual(
      [3, 4, 5].map(() => ({
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

/**
 * The JSON key operations against PGlite: each rewrites the objects its path reaches in the rows that
 * need it, leaves every other row as it was, holds its postcheck afterwards, and is skipped on a
 * second run.
 */
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RenameStoredKeyCall,
} from '@internal/target-postgres/op-factory-call';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

const PLACES = [
  {
    id: 1,
    point: { lat: 1, lng: 2 },
    history: [{ lat: 1 }, { lat: 2, x: 1 }],
    wrapped: { point: { lat: 1 } },
    trips: [{ stops: [{ lat: 1 }, null] }],
  },
  {
    id: 2,
    point: { lng: 3 },
    history: [null, { lat: 3 }],
    wrapped: { point: null },
    trips: [{ stops: [] }, null],
  },
  { id: 3, point: null, history: [], wrapped: {}, trips: [{ stops: null }] },
  { id: 4, point: undefined, history: undefined, wrapped: undefined, trips: undefined },
  { id: 5, point: 'str', history: null, wrapped: { point: { lng: 1 } }, trips: [] },
] as const;

const COLUMNS = ['point', 'history', 'wrapped', 'trips'] as const;
type PlaceColumn = (typeof COLUMNS)[number];

describe('Postgres stored key operations', { concurrent: false }, () => {
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
    await driver.query('drop schema if exists app cascade');
    await driver.query('create schema app');
    await driver.query(
      'create table app.place (id int primary key, point jsonb, history jsonb, wrapped jsonb, trips jsonb)',
    );
    for (const place of PLACES) {
      await driver.query(
        'insert into app.place (id, point, history, wrapped, trips) values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)',
        [place.id, ...COLUMNS.map((column) => jsonParam(place[column]))],
      );
    }
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
  }, testTimeout);

  function jsonParam(value: unknown): string | null {
    return value === undefined ? null : JSON.stringify(value);
  }

  async function postchecksHold(op: Op): Promise<boolean> {
    for (const step of op.postcheck) {
      const result = await driver.query<{ result: boolean }>(step.sql, step.params ?? []);
      if (result.rows[0]?.result !== true) return false;
    }
    return true;
  }

  async function runnerResult(op: Op) {
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [op],
      providedInvariants: [],
    });
    return postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver,
          destinationContract: contract,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          frameworkComponents,
        },
      ],
    });
  }

  async function operationsExecuted(op: Op): Promise<number> {
    const result = await runnerResult(op);
    if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
    return result.value.perSpaceResults.reduce(
      (sum, { value }) => sum + value.operationsExecuted,
      0,
    );
  }

  async function rowVersions(): Promise<Record<number, string>> {
    const result = await driver.query<{ id: number; version: string }>(
      'select id, xmin::text as version from app.place order by id',
    );
    return Object.fromEntries(result.rows.map(({ id, version }) => [id, version]));
  }

  /** Runs the operation twice, and returns the ids of the rows the first run wrote. */
  async function runTwice(op: Op): Promise<readonly number[]> {
    const before = await rowVersions();
    expect(await postchecksHold(op), 'postcheck before').toBe(false);
    expect(await operationsExecuted(op), 'first run').toBe(1);
    expect(await postchecksHold(op), 'postcheck after').toBe(true);
    expect(await operationsExecuted(op), 'second run').toBe(0);
    const after = await rowVersions();
    return Object.keys(before)
      .map(Number)
      .filter((id) => before[id] !== after[id]);
  }

  async function values(column: PlaceColumn): Promise<unknown[]> {
    const result = await driver.query<{ value: unknown }>(
      `select ${column} as value from app.place order by id`,
    );
    return result.rows.map(({ value }) => value);
  }

  function original(column: PlaceColumn): unknown[] {
    return PLACES.map((place) => place[column] ?? null);
  }

  describe('renameStoredKey', () => {
    it.each([
      [
        'an object column',
        'point',
        '$.lat',
        [1],
        [{ latitude: 1, lng: 2 }, { lng: 3 }, null, null, 'str'],
      ],
      [
        'a list of objects',
        'history',
        '$[*].lat',
        [1, 2],
        [[{ latitude: 1 }, { latitude: 2, x: 1 }], [null, { latitude: 3 }], [], null, null],
      ],
      [
        'an object nested in an object',
        'wrapped',
        '$.point.lat',
        [1],
        [{ point: { latitude: 1 } }, { point: null }, {}, null, { point: { lng: 1 } }],
      ],
      [
        'a list inside an object inside a list',
        'trips',
        '$[*].stops[*].lat',
        [1],
        [[{ stops: [{ latitude: 1 }, null] }], [{ stops: [] }, null], [{ stops: null }], null, []],
      ],
    ] as const)(
      'renames the key in %s, and writes only the rows that hold it',
      { timeout: testTimeout },
      async (_, column, path, written, expected) => {
        const op = await new RenameStoredKeyCall('app', 'place', column, path, 'latitude').toOp();

        expect(await runTwice(op)).toEqual(written);
        expect(await values(column)).toEqual(expected);
      },
    );

    it('fails its precheck, and changes nothing, when an object already has the new key', {
      timeout: testTimeout,
    }, async () => {
      await driver.query(
        `update app.place set history = '[{"lat": 1}, {"lat": 2, "latitude": 9}]' where id = 1`,
      );
      const op = await new RenameStoredKeyCall(
        'app',
        'place',
        'history',
        '$[*].lat',
        'latitude',
      ).toOp();

      expect((await runnerResult(op)).assertNotOk()).toMatchObject({
        code: 'MIGRATION.PRECHECK_FAILED',
        message:
          'Operation renameStoredKey.place.history.$[*].lat failed during precheck: ensure no object at path "$[*]" in column "history" of "place" has both key "lat" and key "latitude"',
      });
      expect(await values('history')).toEqual([
        [{ lat: 1 }, { lat: 2, latitude: 9 }],
        ...original('history').slice(1),
      ]);
    });
  });

  describe('removeStoredKey', () => {
    it.each([
      ['an object column', 'point', '$.lat', [1], [{ lng: 2 }, { lng: 3 }, null, null, 'str']],
      [
        'a list of objects',
        'history',
        '$[*].lat',
        [1, 2],
        [[{}, { x: 1 }], [null, {}], [], null, null],
      ],
      [
        'an object nested in an object',
        'wrapped',
        '$.point.lat',
        [1],
        [{ point: {} }, { point: null }, {}, null, { point: { lng: 1 } }],
      ],
      [
        'a list inside an object inside a list',
        'trips',
        '$[*].stops[*].lat',
        [1],
        [[{ stops: [{}, null] }], [{ stops: [] }, null], [{ stops: null }], null, []],
      ],
    ] as const)(
      'removes the key in %s, and writes only the rows that hold it',
      { timeout: testTimeout },
      async (_, column, path, written, expected) => {
        const op = await new RemoveStoredKeyCall('app', 'place', column, path).toOp();

        expect(await runTwice(op)).toEqual(written);
        expect(await values(column)).toEqual(expected);
      },
    );
  });

  describe('fillStoredKey', () => {
    const NZ = { code: 'NZ' };

    it.each([
      [
        'an object column',
        'point',
        '$.country',
        [1, 2],
        [{ lat: 1, lng: 2, country: NZ }, { lng: 3, country: NZ }, null, null, 'str'],
      ],
      [
        'a list of objects',
        'history',
        '$[*].country',
        [1, 2],
        [
          [
            { lat: 1, country: NZ },
            { lat: 2, x: 1, country: NZ },
          ],
          [null, { lat: 3, country: NZ }],
          [],
          null,
          null,
        ],
      ],
      [
        'an object nested in an object',
        'wrapped',
        '$.point.country',
        [1, 5],
        [
          { point: { lat: 1, country: NZ } },
          { point: null },
          {},
          null,
          { point: { lng: 1, country: NZ } },
        ],
      ],
      [
        'a list inside an object inside a list',
        'trips',
        '$[*].stops[*].country',
        [1],
        [
          [{ stops: [{ lat: 1, country: NZ }, null] }],
          [{ stops: [] }, null],
          [{ stops: null }],
          null,
          [],
        ],
      ],
    ] as const)(
      'fills the key in %s, and writes only the rows with an object that lacks it',
      { timeout: testTimeout },
      async (_, column, path, written, expected) => {
        const op = await new FillStoredKeyCall('app', 'place', column, path, NZ).toOp();

        expect(await runTwice(op)).toEqual(written);
        expect(await values(column)).toEqual(expected);
      },
    );

    it('keeps the value of an object that has the key', { timeout: testTimeout }, async () => {
      await driver.query(
        `update app.place set point = '{"lng": 3, "country": {"code": "AU"}}' where id = 2`,
      );

      await operationsExecuted(
        await new FillStoredKeyCall('app', 'place', 'point', '$.country', NZ).toOp(),
      );

      expect((await values('point')).slice(0, 2)).toEqual([
        { lat: 1, lng: 2, country: NZ },
        { lng: 3, country: { code: 'AU' } },
      ]);
    });
  });
});

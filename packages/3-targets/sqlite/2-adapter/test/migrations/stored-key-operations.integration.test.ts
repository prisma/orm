/**
 * The JSON key operations against SQLite: each rewrites the objects its path reaches in the rows that
 * need it, leaves every other row byte for byte, holds its postcheck afterwards, and is skipped on a
 * second run.
 */
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { RenameStoredKeyCall } from '@internal/target-sqlite/op-factory-call';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  LEDGER_TEST_SPACE_ID,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

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

/** JSON text with blank space, which a rewrite drops, so a written row shows in its text. */
function spacedJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value, null, 1);
}

describe('SQLite stored key operations', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = createTestDatabase();
    await testDb.driver.query(
      'CREATE TABLE "place" (id INTEGER PRIMARY KEY, point TEXT, history TEXT, wrapped TEXT, trips TEXT)',
    );
    for (const place of PLACES) {
      await testDb.driver.query(
        'INSERT INTO "place" (id, point, history, wrapped, trips) VALUES (?1, ?2, ?3, ?4, ?5)',
        [place.id, ...COLUMNS.map((column) => spacedJson(place[column]))],
      );
    }
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  async function postchecksHold(op: Op): Promise<boolean> {
    for (const step of op.postcheck) {
      const result = await testDb.driver.query<{ result: number }>(step.sql, step.params ?? []);
      if (result.rows[0]?.result !== 1) return false;
    }
    return true;
  }

  async function runnerResult(op: Op) {
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [op],
      providedInvariants: [],
    });
    return sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver: testDb.driver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver: testDb.driver,
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

  async function texts(column: PlaceColumn): Promise<(string | null)[]> {
    const result = await testDb.driver.query<{ value: string | null }>(
      `SELECT ${column} AS value FROM "place" ORDER BY id`,
    );
    return result.rows.map(({ value }) => value);
  }

  /** Runs the operation twice, and returns the ids of the rows the first run changed the text of. */
  async function runTwice(op: Op, column: PlaceColumn): Promise<readonly number[]> {
    const before = await texts(column);
    expect(await postchecksHold(op), 'postcheck before').toBe(false);
    expect(await operationsExecuted(op), 'first run').toBe(1);
    expect(await postchecksHold(op), 'postcheck after').toBe(true);
    expect(await operationsExecuted(op), 'second run').toBe(0);
    const after = await texts(column);
    return PLACES.flatMap((place, index) => (before[index] === after[index] ? [] : [place.id]));
  }

  async function values(column: PlaceColumn): Promise<unknown[]> {
    return (await texts(column)).map((text) => (text === null ? undefined : JSON.parse(text)));
  }

  describe('renameStoredKey', () => {
    it.each([
      [
        'an object column',
        'point',
        '$.lat',
        [1],
        [{ latitude: 1, lng: 2 }, { lng: 3 }, null, undefined, 'str'],
      ],
      [
        'a list of objects',
        'history',
        '$[*].lat',
        [1, 2],
        [[{ latitude: 1 }, { latitude: 2, x: 1 }], [null, { latitude: 3 }], [], undefined, null],
      ],
      [
        'an object nested in an object',
        'wrapped',
        '$.point.lat',
        [1],
        [{ point: { latitude: 1 } }, { point: null }, {}, undefined, { point: { lng: 1 } }],
      ],
      [
        'a list inside an object inside a list',
        'trips',
        "$[*]['stops'][*].lat",
        [1],
        [
          [{ stops: [{ latitude: 1 }, null] }],
          [{ stops: [] }, null],
          [{ stops: null }],
          undefined,
          [],
        ],
      ],
    ] as const)(
      'renames the key in %s, and writes only the rows that hold it',
      async (_, column, path, written, expected) => {
        const op = await new RenameStoredKeyCall('place', column, path, 'latitude').toOp();

        expect(await runTwice(op, column)).toEqual(written);
        expect(await values(column)).toEqual(expected);
      },
    );

    it('fails its precheck, and changes nothing, when an object already has the new key', async () => {
      await testDb.driver.query(
        `UPDATE "place" SET history = '[{"lat": 1}, {"lat": 2, "latitude": 9}]' WHERE id = 1`,
      );
      const before = await texts('history');
      const op = await new RenameStoredKeyCall('place', 'history', '$[*].lat', 'latitude').toOp();

      expect((await runnerResult(op)).assertNotOk()).toMatchObject({
        code: 'MIGRATION.PRECHECK_FAILED',
        message:
          'Operation renameStoredKey.place.history.$[*].lat failed during precheck: ensure no object at path "$[*]" in column "history" of "place" has both key "lat" and key "latitude"',
      });
      expect(await texts('history')).toEqual(before);
    });
  });
});

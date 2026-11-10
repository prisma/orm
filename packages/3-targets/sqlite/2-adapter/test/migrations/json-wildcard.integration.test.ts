/**
 * The RFC 9535 wildcard against SQLite: `[*]` and `.*` select every child, the elements of a list
 * and the member values of an object, in each operation that takes a path. A SQL `NULL`, a JSON
 * `null` member and an empty object are left as they are.
 */
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
  RenameStoredKeyCall,
  ReplaceStoredValueCall,
} from '@internal/target-sqlite/op-factory-call';
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
    byCountry: { nz: { lat: 1, lng: 2 }, au: { lat: 2 } },
    statuses: { a: 'archived', b: 'active' },
  },
  { id: 2, byCountry: { nz: null, au: { lng: 3 } }, statuses: { a: null } },
  { id: 3, byCountry: {}, statuses: {} },
  { id: 4, byCountry: undefined, statuses: undefined },
  { id: 5, byCountry: [{ lat: 5 }], statuses: ['archived', 'active'] },
] as const;

const COLUMNS = ['byCountry', 'statuses'] as const;
type PlaceColumn = (typeof COLUMNS)[number];

describe('SQLite JSON wildcard', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = createTestDatabase();
    await testDb.driver.query(
      'CREATE TABLE "place" (id INTEGER PRIMARY KEY, "byCountry" TEXT, statuses TEXT)',
    );
    for (const place of PLACES) {
      await testDb.driver.query(
        'INSERT INTO "place" (id, "byCountry", statuses) VALUES (?1, ?2, ?3)',
        [
          place.id,
          ...COLUMNS.map((column) =>
            place[column] === undefined ? null : JSON.stringify(place[column], null, 1),
          ),
        ],
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

  async function operationsExecuted(op: Op): Promise<number> {
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [op],
      providedInvariants: [],
    });
    const result = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
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
    if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
    return result.value.perSpaceResults.reduce(
      (sum, { value }) => sum + value.operationsExecuted,
      0,
    );
  }

  async function texts(column: PlaceColumn): Promise<(string | null)[]> {
    const result = await testDb.driver.query<{ value: string | null }>(
      `SELECT "${column}" AS value FROM "place" ORDER BY id`,
    );
    return result.rows.map(({ value }) => value);
  }

  /** Runs the operation twice, and returns the ids of the rows the first run changed and the values after. */
  async function runTwice(op: Op, column: PlaceColumn) {
    const before = await texts(column);
    expect(await postchecksHold(op), 'postcheck before').toBe(false);
    expect(await operationsExecuted(op), 'first run').toBe(1);
    expect(await postchecksHold(op), 'postcheck after').toBe(true);
    expect(await operationsExecuted(op), 'second run').toBe(0);
    const after = await texts(column);
    return {
      written: PLACES.flatMap((place, index) => (before[index] === after[index] ? [] : [place.id])),
      values: after.map((text) => (text === null ? undefined : JSON.parse(text))),
    };
  }

  it.each([
    ['[*]', '$[*].lat'],
    ['.*', '$.*.lat'],
  ])('renames a key in every member value of an object with %s', async (_, path) => {
    const op = await new RenameStoredKeyCall('place', 'byCountry', path, 'latitude').toOp();

    expect(await runTwice(op, 'byCountry')).toEqual({
      written: [1, 5],
      values: [
        { nz: { latitude: 1, lng: 2 }, au: { latitude: 2 } },
        { nz: null, au: { lng: 3 } },
        {},
        undefined,
        [{ latitude: 5 }],
      ],
    });
    expect((await texts('byCountry'))[0], 'the dictionary keeps its order').toBe(
      '{"nz":{"lng":2,"latitude":1},"au":{"latitude":2}}',
    );
  });

  it('removes a key in every member value of an object', async () => {
    const op = await new RemoveStoredKeyCall('place', 'byCountry', '$[*].lat').toOp();

    expect(await runTwice(op, 'byCountry')).toEqual({
      written: [1, 5],
      values: [{ nz: { lng: 2 }, au: {} }, { nz: null, au: { lng: 3 } }, {}, undefined, [{}]],
    });
  });

  it('fills a key in every member value of an object that is an object', async () => {
    const op = await new FillStoredKeyCall('place', 'byCountry', '$[*].country', 'NZ').toOp();

    expect(await runTwice(op, 'byCountry')).toEqual({
      written: [1, 2, 5],
      values: [
        { nz: { lat: 1, lng: 2, country: 'NZ' }, au: { lat: 2, country: 'NZ' } },
        { nz: null, au: { lng: 3, country: 'NZ' } },
        {},
        undefined,
        [{ lat: 5, country: 'NZ' }],
      ],
    });
  });

  it('replaces a value that a member of an object holds, as it does an element of a list', async () => {
    const op = await new ReplaceStoredValueCall(
      'place',
      'statuses',
      'archived',
      'retired',
      undefined,
      '$.*',
    ).toOp();

    expect(await runTwice(op, 'statuses')).toEqual({
      written: [1, 5],
      values: [{ a: 'retired', b: 'active' }, { a: null }, {}, undefined, ['retired', 'active']],
    });
  });

  it('removes the member of an object that holds the value, as it removes an element of a list', async () => {
    const op = await new RemoveStoredValueCall(
      'place',
      'statuses',
      'archived',
      undefined,
      undefined,
      '$[*]',
    ).toOp();

    expect(await runTwice(op, 'statuses')).toEqual({
      written: [1, 5],
      values: [{ b: 'active' }, { a: null }, {}, undefined, ['active']],
    });
  });
});

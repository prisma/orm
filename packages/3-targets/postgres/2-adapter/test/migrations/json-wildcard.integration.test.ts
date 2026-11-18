/**
 * The RFC 9535 wildcard against PGlite: `[*]` and `.*` select every child, the elements of a list
 * and the member values of an object, in each operation that takes a path. A SQL `NULL`, a JSON
 * `null` member and an empty object are left as they are. A `json` column is read and written as a
 * `jsonb` one is.
 */
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
  RenameStoredKeyCall,
  ReplaceStoredValueCall,
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

describe.each(['jsonb', 'json'] as const)(
  'Postgres JSON wildcard on a %s column',
  { concurrent: false },
  (columnType) => {
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
        `create table app.place (id int primary key, "byCountry" ${columnType}, statuses ${columnType})`,
      );
      for (const place of PLACES) {
        await driver.query(
          `insert into app.place (id, "byCountry", statuses) values ($1, $2::${columnType}, $3::${columnType})`,
          [
            place.id,
            ...COLUMNS.map((column) =>
              place[column] === undefined ? null : JSON.stringify(place[column]),
            ),
          ],
        );
      }
    }, testTimeout);

    afterEach(async () => {
      await driver?.close();
    }, testTimeout);

    async function postchecksHold(op: Op): Promise<boolean> {
      for (const step of op.postcheck) {
        const result = await driver.query<{ result: boolean }>(step.sql, step.params ?? []);
        if (result.rows[0]?.result !== true) return false;
      }
      return true;
    }

    async function operationsExecuted(op: Op): Promise<number> {
      const plan = createMigrationPlan<PostgresPlanTargetDetails>({
        targetId: 'postgres',
        spaceId: LEDGER_TEST_SPACE_ID,
        origin: null,
        destination: toPlanContractInfo(contract),
        operations: [op],
        providedInvariants: [],
      });
      const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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
      if (!result.ok) throw new Error(`${result.failure.code}: ${result.failure.message}`);
      return result.value.perSpaceResults.reduce(
        (sum, { value }) => sum + value.operationsExecuted,
        0,
      );
    }

    async function texts(column: PlaceColumn): Promise<(string | null)[]> {
      const result = await driver.query<{ value: string | null }>(
        `select "${column}"::text as value from app.place order by id`,
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
        written: PLACES.flatMap((place, index) =>
          before[index] === after[index] ? [] : [place.id],
        ),
        values: after.map((text) => (text === null ? undefined : JSON.parse(text))),
      };
    }

    it.each([
      ['[*]', '$[*].lat'],
      ['.*', '$.*.lat'],
    ])('renames a key in every member value of an object with %s', async (_, path) => {
      const op = await new RenameStoredKeyCall(
        'app',
        'place',
        'byCountry',
        path,
        'latitude',
      ).toOp();

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
    });

    it('removes a key in every member value of an object', async () => {
      const op = await new RemoveStoredKeyCall('app', 'place', 'byCountry', '$[*].lat').toOp();

      expect(await runTwice(op, 'byCountry')).toEqual({
        written: [1, 5],
        values: [{ nz: { lng: 2 }, au: {} }, { nz: null, au: { lng: 3 } }, {}, undefined, [{}]],
      });
    });

    it('fills a key in every member value of an object that is an object', async () => {
      const op = await new FillStoredKeyCall(
        'app',
        'place',
        'byCountry',
        '$[*].country',
        'NZ',
      ).toOp();

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
        'app',
        'place',
        'statuses',
        'archived',
        'retired',
        false,
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
        'app',
        'place',
        'statuses',
        'archived',
        false,
        undefined,
        undefined,
        '$[*]',
      ).toOp();

      expect(await runTwice(op, 'statuses')).toEqual({
        written: [1, 5],
        values: [{ b: 'active' }, { a: null }, {}, undefined, ['active']],
      });
    });
  },
);

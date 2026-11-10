/**
 * `replaceStoredValue` and `removeStoredValue` against a real database: each rewrites the rows that hold the
 * value and leaves the others, its postcheck holds afterwards, and the runner skips it on a
 * second run.
 */
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
  DeleteRowsCall,
  RemoveStoredValueCall,
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

describe('SQLite stored value operations', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = createTestDatabase();
    await testDb.driver.query(
      'CREATE TABLE "task" (id INTEGER PRIMARY KEY, state TEXT, rank INTEGER)',
    );
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

  async function runnerResult(op: Op, driver: TestDatabase['driver'] = testDb.driver) {
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(contract),
      operations: [op],
      providedInvariants: [],
    });
    return sqliteTargetDescriptor.createRunner(familyInstance).execute({
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

  async function runTwice(op: Op): Promise<void> {
    expect(await postchecksHold(op), 'postcheck before').toBe(false);
    expect(await operationsExecuted(op), 'first run').toBe(1);
    expect(await postchecksHold(op), 'postcheck after').toBe(true);
    expect(await operationsExecuted(op), 'second run').toBe(0);
  }

  async function rows(column: string): Promise<unknown[]> {
    return (await testDb.driver.query(`SELECT id, ${column} FROM "task" ORDER BY id`)).rows;
  }

  it('replaces a text value in the rows that hold it, and leaves the others', async () => {
    await testDb.driver.query(
      `INSERT INTO "task" (id, state) VALUES (1, 'ARCHIVED'), (2, 'ACTIVE'), (3, NULL), (4, 'ARCHIVED')`,
    );

    await runTwice(await new ReplaceStoredValueCall('task', 'state', 'ARCHIVED', 'RETIRED').toOp());

    expect(await rows('state')).toEqual([
      { id: 1, state: 'RETIRED' },
      { id: 2, state: 'ACTIVE' },
      { id: 3, state: null },
      { id: 4, state: 'RETIRED' },
    ]);
  });

  it('deletes the rows that hold a value, and keeps the others', async () => {
    await testDb.driver.query(
      `INSERT INTO "task" (id, state, rank) VALUES (1, 'Bug', 1), (2, 'Feature', 2), (3, NULL, 3), (4, 'Bug', 4)`,
    );

    await runTwice(await new DeleteRowsCall('task', 'state', 'Bug').toOp());
    await runTwice(await new DeleteRowsCall('task', 'rank', 3).toOp());

    expect(await rows('state')).toEqual([{ id: 2, state: 'Feature' }]);
  });

  it('replaces and removes a numeric value', async () => {
    await testDb.driver.query('INSERT INTO "task" (id, rank) VALUES (1, 1), (2, 2), (3, 3)');

    await runTwice(await new ReplaceStoredValueCall('task', 'rank', 1, 10).toOp());
    await runTwice(await new RemoveStoredValueCall('task', 'rank', 3).toOp());

    expect(await rows('rank')).toEqual([
      { id: 1, rank: 10 },
      { id: 2, rank: 2 },
      { id: 3, rank: null },
    ]);
  });

  it('removes a text value by setting it to NULL', async () => {
    await testDb.driver.query(
      `INSERT INTO "task" (id, state) VALUES (1, 'ARCHIVED'), (2, 'ACTIVE')`,
    );

    await runTwice(await new RemoveStoredValueCall('task', 'state', 'ARCHIVED').toOp());

    expect(await rows('state')).toEqual([
      { id: 1, state: null },
      { id: 2, state: 'ACTIVE' },
    ]);
  });

  it('replaces a value with a quote in it', async () => {
    await testDb.driver.query(`INSERT INTO "task" (id, state) VALUES (1, 'it''s'), (2, 'its')`);

    await runTwice(await new ReplaceStoredValueCall('task', 'state', "it's", 'it"s').toOp());

    expect(await rows('state')).toEqual([
      { id: 1, state: 'it"s' },
      { id: 2, state: 'its' },
    ]);
  });

  it('fails its precheck, and changes nothing, when a value would be removed from a required column', async () => {
    await testDb.driver.query('CREATE TABLE "code" (id INTEGER PRIMARY KEY, code TEXT NOT NULL)');
    await testDb.driver.query(`INSERT INTO "code" (id, code) VALUES (1, 'x'), (2, 'y')`);

    const result = await runnerResult(await new RemoveStoredValueCall('code', 'code', 'x').toOp());

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation removeStoredValue.code.code.x failed during precheck: ensure column "code" of "code" takes NULL, or no row holds "x" in it',
    });
    expect((await testDb.driver.query('SELECT id, code FROM "code" ORDER BY id')).rows).toEqual([
      { id: 1, code: 'x' },
      { id: 2, code: 'y' },
    ]);
  });

  it('removes nothing, and runs nothing, from a required column no row of which holds the value', async () => {
    await testDb.driver.query('CREATE TABLE "code" (id INTEGER PRIMARY KEY, code TEXT NOT NULL)');
    await testDb.driver.query(`INSERT INTO "code" (id, code) VALUES (1, 'y')`);

    expect(
      await operationsExecuted(await new RemoveStoredValueCall('code', 'code', 'x').toOp()),
    ).toBe(0);
  });

  it('still reports the failed check, without a count, when the count fails', async () => {
    await testDb.driver.query('CREATE TABLE "code" (id INTEGER PRIMARY KEY, code TEXT NOT NULL)');
    await testDb.driver.query(`INSERT INTO "code" (id, code) VALUES (1, 'x')`);
    const op = await new RemoveStoredValueCall('code', 'code', 'x', undefined, {
      enum: 'Code',
      member: 'X',
    }).toOp();
    const { driver } = testDb;
    const failingCount: TestDatabase['driver'] = {
      ...driver,
      query: (sql, params) =>
        sql.startsWith('SELECT COUNT(*) AS rows')
          ? Promise.reject(new Error('database is locked'))
          : driver.query(sql, params),
    };

    const failure = (await runnerResult(op, failingCount)).assertNotOk();

    expect({
      code: failure.code,
      message: failure.message,
      counted: failure.meta.rowsHoldingValue,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation removeStoredValue.code.code.x failed during precheck: ensure column "code" of "code" takes NULL, or no row holds "x" in it',
      counted: undefined,
    });
  });
});

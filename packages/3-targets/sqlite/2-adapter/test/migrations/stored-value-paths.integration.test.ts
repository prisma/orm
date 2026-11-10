/**
 * `replaceStoredValue` and `removeStoredValue` with a path against SQLite: each acts on the value at
 * the path inside the JSON of a column, compared as a JSON value, writes only the rows that hold it,
 * leaves every other row byte for byte, and is skipped on a second run.
 */
import { asNamespaceId } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
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

const DOCS = [
  {
    status: 'OPEN',
    tags: ['a', 'b', 'a'],
    items: [{ status: 'OPEN' }, null, { status: 'DONE' }],
    sub: { status: 'OPEN' },
  },
  { status: 'DONE', tags: [], items: [], sub: null },
  null,
  undefined,
  { status: 1, tags: [null, 'a'], items: [{ tags: ['a'] }], sub: {} },
  'OPEN',
] as const;

const ENUM_VALUE = { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'OPEN' };

describe('SQLite stored values at a path', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = createTestDatabase();
    await testDb.driver.query('CREATE TABLE "issue" (id INTEGER PRIMARY KEY, doc TEXT)');
    for (const [index, doc] of DOCS.entries()) {
      await testDb.driver.query('INSERT INTO "issue" (id, doc) VALUES (?1, ?2)', [
        index + 1,
        doc === undefined ? null : JSON.stringify(doc, null, 1),
      ]);
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

  async function rowVersions(): Promise<readonly (string | null)[]> {
    const result = await testDb.driver.query<{ doc: string | null }>(
      'SELECT doc FROM "issue" ORDER BY id',
    );
    return result.rows.map(({ doc }) => doc);
  }

  /** Runs the operation twice, and returns the ids of the rows the first run wrote. */
  async function runTwice(op: Op): Promise<readonly number[]> {
    const before = await rowVersions();
    expect(await postchecksHold(op), 'postcheck before').toBe(false);
    expect(await operationsExecuted(op), 'first run').toBe(1);
    expect(await postchecksHold(op), 'postcheck after').toBe(true);
    expect(await operationsExecuted(op), 'second run').toBe(0);
    const after = await rowVersions();
    return before.flatMap((version, index) => (version === after[index] ? [] : [index + 1]));
  }

  async function docs(): Promise<unknown[]> {
    return (await rowVersions()).map((doc) => (doc === null ? undefined : JSON.parse(doc)));
  }

  function changed(rows: Readonly<Record<number, unknown>>): unknown[] {
    return DOCS.map((doc, index) => (index + 1 in rows ? rows[index + 1] : doc));
  }

  it.each([
    [
      'a member of an object column',
      new ReplaceStoredValueCall('issue', 'doc', 'OPEN', 'CLOSED', undefined, '$.status'),
      { 1: { ...DOCS[0], status: 'CLOSED' } },
    ],
    [
      'a member of the objects of a list',
      new ReplaceStoredValueCall('issue', 'doc', 'OPEN', 'CLOSED', undefined, '$.items[*].status'),
      { 1: { ...DOCS[0], items: [{ status: 'CLOSED' }, null, { status: 'DONE' }] } },
    ],
    [
      'a member of an object nested in an object',
      new ReplaceStoredValueCall('issue', 'doc', 'OPEN', 'CLOSED', undefined, '$.sub.status'),
      { 1: { ...DOCS[0], sub: { status: 'CLOSED' } } },
    ],
    [
      'the elements of a list',
      new ReplaceStoredValueCall('issue', 'doc', 'a', 'z', undefined, '$.tags[*]'),
      {
        1: { ...DOCS[0], tags: ['z', 'b', 'z'] },
        5: { ...DOCS[4], tags: [null, 'z'] },
      },
    ],
    [
      'the elements of a list inside an object inside a list',
      new ReplaceStoredValueCall('issue', 'doc', 'a', 'z', undefined, '$.items[*].tags[*]'),
      { 5: { ...DOCS[4], items: [{ tags: ['z'] }] } },
    ],
    [
      'a number, which a string never matches',
      new ReplaceStoredValueCall('issue', 'doc', 1, 2, undefined, '$.status'),
      { 5: { ...DOCS[4], status: 2 } },
    ],
  ] as const)(
    'replaces the value at %s, and writes only the rows that hold it',
    async (_, call, rows) => {
      expect(await runTwice(await call.toOp())).toEqual(Object.keys(rows).map(Number));
      expect(await docs()).toEqual(changed(rows));
    },
  );

  it('removes a value from the elements of a list', async () => {
    const call = new RemoveStoredValueCall('issue', 'doc', 'a', undefined, undefined, '$.tags[*]');

    expect(await runTwice(await call.toOp())).toEqual([1, 5]);
    expect(await docs()).toEqual(
      changed({ 1: { ...DOCS[0], tags: ['b'] }, 5: { ...DOCS[4], tags: [null] } }),
    );
  });

  it('sets a member that takes null to JSON null', async () => {
    const call = new RemoveStoredValueCall(
      'issue',
      'doc',
      'OPEN',
      undefined,
      undefined,
      '$.items[*].status',
      true,
    );

    expect(await runTwice(await call.toOp())).toEqual([1]);
    expect(await docs()).toEqual(
      changed({ 1: { ...DOCS[0], items: [{ status: null }, null, { status: 'DONE' }] } }),
    );
  });

  it('fails its precheck, counts the rows, and changes nothing, while a member that takes no null holds the value', async () => {
    const call = new RemoveStoredValueCall(
      'issue',
      'doc',
      'OPEN',
      undefined,
      ENUM_VALUE,
      '$.status',
    );

    const failure = (await runnerResult(await call.toOp())).assertNotOk();

    expect({
      code: failure.code,
      message: failure.message,
      rowsHoldingValue: failure.meta.rowsHoldingValue,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        '1 row of "issue" holds "OPEN" at path "$.status" in column "doc", a member that takes no null, so the value cannot be removed.',
      rowsHoldingValue: [
        {
          enumValue: ENUM_VALUE,
          value: 'OPEN',
          rows: 1,
          operationIndex: 0,
          keepDataEdit: {
            remove:
              'this.removeStoredValue({ table: "issue", column: "doc", path: "$.status", value: "OPEN", enumValue: { namespaceId: "app", enum: "Status", member: "OPEN" } })',
            replaceWith:
              'this.replaceStoredValue({ table: "issue", column: "doc", path: "$.status", from: "OPEN", to: "<stored value>" })',
          },
        },
      ],
    });
    expect(await docs()).toEqual(changed({}));
  });

  it('runs nothing when no member that takes no null holds the value', async () => {
    const call = new RemoveStoredValueCall(
      'issue',
      'doc',
      'GONE',
      undefined,
      ENUM_VALUE,
      '$.status',
    );

    expect(await operationsExecuted(await call.toOp())).toBe(0);
  });
});

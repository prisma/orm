/**
 * `replaceStoredValue` and `removeStoredValue` with a path against PGlite: each acts on the value at
 * the path inside the JSON of a column, compared as a JSON value, writes only the rows that hold it,
 * and is skipped on a second run.
 */
import { asNamespaceId } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import {
  RemoveStoredValueCall,
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

describe('Postgres stored values at a path', { concurrent: false }, () => {
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
    await driver.query('create table app.issue (id int primary key, doc jsonb)');
    for (const [index, doc] of DOCS.entries()) {
      await driver.query('insert into app.issue (id, doc) values ($1, $2::jsonb)', [
        index + 1,
        doc === undefined ? null : JSON.stringify(doc),
      ]);
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

  async function rowVersions(): Promise<readonly string[]> {
    const result = await driver.query<{ version: string }>(
      'select xmin::text as version from app.issue order by id',
    );
    return result.rows.map(({ version }) => version);
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
    const result = await driver.query<{ doc: unknown }>('select doc from app.issue order by id');
    return result.rows.map(({ doc }) => doc);
  }

  function changed(rows: Readonly<Record<number, unknown>>): unknown[] {
    return DOCS.map((doc, index) => (index + 1 in rows ? rows[index + 1] : (doc ?? null)));
  }

  it.each([
    [
      'a member of an object column',
      new ReplaceStoredValueCall(
        'app',
        'issue',
        'doc',
        'OPEN',
        'CLOSED',
        false,
        undefined,
        '$.status',
      ),
      { 1: { ...DOCS[0], status: 'CLOSED' } },
    ],
    [
      'a member of the objects of a list',
      new ReplaceStoredValueCall(
        'app',
        'issue',
        'doc',
        'OPEN',
        'CLOSED',
        false,
        undefined,
        '$.items[*].status',
      ),
      { 1: { ...DOCS[0], items: [{ status: 'CLOSED' }, null, { status: 'DONE' }] } },
    ],
    [
      'a member of an object nested in an object',
      new ReplaceStoredValueCall(
        'app',
        'issue',
        'doc',
        'OPEN',
        'CLOSED',
        false,
        undefined,
        '$.sub.status',
      ),
      { 1: { ...DOCS[0], sub: { status: 'CLOSED' } } },
    ],
    [
      'the elements of a list',
      new ReplaceStoredValueCall('app', 'issue', 'doc', 'a', 'z', false, undefined, '$.tags[*]'),
      {
        1: { ...DOCS[0], tags: ['z', 'b', 'z'] },
        5: { ...DOCS[4], tags: [null, 'z'] },
      },
    ],
    [
      'the elements of a list inside an object inside a list',
      new ReplaceStoredValueCall(
        'app',
        'issue',
        'doc',
        'a',
        'z',
        false,
        undefined,
        '$.items[*].tags[*]',
      ),
      { 5: { ...DOCS[4], items: [{ tags: ['z'] }] } },
    ],
    [
      'a number, which a string never matches',
      new ReplaceStoredValueCall('app', 'issue', 'doc', 1, 2, false, undefined, '$.status'),
      { 5: { ...DOCS[4], status: 2 } },
    ],
  ] as const)(
    'replaces the value at %s, and writes only the rows that hold it',
    {
      timeout: testTimeout,
    },
    async (_, call, rows) => {
      expect(await runTwice(await call.toOp())).toEqual(Object.keys(rows).map(Number));
      expect(await docs()).toEqual(changed(rows));
    },
  );

  it('removes a value from the elements of a list', { timeout: testTimeout }, async () => {
    const call = new RemoveStoredValueCall(
      'app',
      'issue',
      'doc',
      'a',
      false,
      undefined,
      undefined,
      '$.tags[*]',
    );

    expect(await runTwice(await call.toOp())).toEqual([1, 5]);
    expect(await docs()).toEqual(
      changed({ 1: { ...DOCS[0], tags: ['b'] }, 5: { ...DOCS[4], tags: [null] } }),
    );
  });

  it('sets a member that takes null to JSON null', { timeout: testTimeout }, async () => {
    const call = new RemoveStoredValueCall(
      'app',
      'issue',
      'doc',
      'OPEN',
      false,
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

  it('fails its precheck, counts the rows, and changes nothing, while a member that takes no null holds the value', {
    timeout: testTimeout,
  }, async () => {
    const call = new RemoveStoredValueCall(
      'app',
      'issue',
      'doc',
      'OPEN',
      false,
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
              'this.removeStoredValue({ schema: "app", table: "issue", column: "doc", path: "$.status", value: "OPEN", enumValue: { namespaceId: "app", enum: "Status", member: "OPEN" } })',
            replaceWith:
              'this.replaceStoredValue({ schema: "app", table: "issue", column: "doc", path: "$.status", from: "OPEN", to: "<stored value>" })',
          },
        },
      ],
    });
    expect(await docs()).toEqual(changed({}));
  });

  it('runs nothing when no member that takes no null holds the value', {
    timeout: testTimeout,
  }, async () => {
    const call = new RemoveStoredValueCall(
      'app',
      'issue',
      'doc',
      'GONE',
      false,
      undefined,
      ENUM_VALUE,
      '$.status',
    );

    expect(await operationsExecuted(await call.toOp())).toBe(0);
  });
});

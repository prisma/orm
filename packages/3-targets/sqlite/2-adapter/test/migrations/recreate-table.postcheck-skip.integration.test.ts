import type { Contract } from '@internal/contract/types';
import { APP_SPACE_ID, planOriginOf } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_CLASSES, counterContract, postContract } from './fixtures/recreate-contracts';
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

describe('a SQLite rebuild whose change the table-level postchecks miss', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    origin = planOriginOf(from),
  ) {
    const schema =
      from === null
        ? emptySchema
        : sqliteTargetDescriptor.migrations.contractToSchema(from, frameworkComponents);
    const result = createSqliteMigrationPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: ALL_CLASSES,
      fromContract: from,
      origin,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    return result.plan;
  }

  async function execute(planned: ReturnType<typeof plan>, contract: Contract<SqlStorage>) {
    const { driver } = testDb;
    const result = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned,
          migrationEdges: synthEdges(planned),
          driver,
          destinationContract: contract,
          policy: ALL_CLASSES,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(formatRunnerFailure(result.failure));
    return result.value.perSpaceResults[0]?.value;
  }

  async function migrate(origin: Contract<SqlStorage>, destination: Contract<SqlStorage>) {
    testDb = createTestDatabase();
    await execute(plan(null, origin), origin);
    return execute(plan(origin, destination), destination);
  }

  it('runs a rebuild that changes only a foreign key action', async () => {
    const result = await migrate(postContract('cascade'), postContract('setNull'));

    const actions = await testDb.driver.query(
      `SELECT on_delete FROM pragma_foreign_key_list('Post')`,
    );
    expect({ result, actions: actions.rows }).toMatchObject({
      result: { operationsExecuted: 1 },
      actions: [{ on_delete: 'SET NULL' }],
    });
  });

  async function tableSql(): Promise<string | undefined> {
    const table = await testDb.driver.query<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Counter'`,
    );
    return table.rows[0]?.sql;
  }

  it('runs a rebuild that only adds autoincrement()', async () => {
    const result = await migrate(counterContract(false), counterContract(true));

    expect({ result, sql: await tableSql() }).toMatchObject({
      result: { operationsExecuted: 1 },
      sql: expect.stringContaining('AUTOINCREMENT'),
    });
  });

  it('runs a rebuild that only removes autoincrement()', async () => {
    const result = await migrate(counterContract(true), counterContract(false));

    expect({ result, sql: await tableSql() }).toMatchObject({
      result: { operationsExecuted: 1 },
      sql: expect.not.stringContaining('AUTOINCREMENT'),
    });
  });

  async function adopt(
    createTableSql: string,
    origin: Contract<SqlStorage>,
    destination: Contract<SqlStorage>,
  ) {
    testDb = createTestDatabase();
    testDb.driver.db.exec(createTableSql);
    return execute(plan(origin, destination, null), destination);
  }

  it.each([
    [
      'written by an earlier Prisma ORM',
      'CREATE TABLE "Counter" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT)',
    ],
    ['with an unquoted name', 'CREATE TABLE Counter (id INTEGER PRIMARY KEY AUTOINCREMENT)'],
    ['with extra spaces', 'CREATE TABLE "Counter" ("id"  INTEGER  PRIMARY  KEY  AUTOINCREMENT)'],
  ])('rebuilds an adopted autoincrement table %s to remove autoincrement()', async (_, sql) => {
    const result = await adopt(sql, counterContract(true), counterContract(false));

    expect({ result, sql: await tableSql() }).toMatchObject({
      result: { operationsExecuted: 1 },
      sql: expect.not.stringContaining('AUTOINCREMENT'),
    });
  });

  it.each([
    [
      'written by an earlier Prisma ORM',
      'CREATE TABLE "Counter" ("id" INTEGER NOT NULL PRIMARY KEY)',
    ],
    ['with an unquoted name', 'CREATE TABLE Counter (id INTEGER NOT NULL, PRIMARY KEY (id))'],
    [
      'with the clause in a comment',
      'CREATE TABLE "Counter" ("id" INTEGER NOT NULL, PRIMARY KEY ("id")) -- "id" INTEGER PRIMARY KEY AUTOINCREMENT',
    ],
  ])('rebuilds an adopted table %s to add autoincrement()', async (_, sql) => {
    const result = await adopt(sql, counterContract(false), counterContract(true));

    expect({ result, sql: await tableSql() }).toMatchObject({
      result: { operationsExecuted: 1 },
      sql: expect.stringContaining('"id" INTEGER PRIMARY KEY AUTOINCREMENT'),
    });
  });
});

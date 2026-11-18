import type { Contract } from '@internal/contract/types';
import { APP_SPACE_ID, planOriginOf } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_CLASSES, integer, postContract } from './fixtures/recreate-contracts';
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

const before = postContract('cascade');
const rebuilt = postContract('setNull');
const withViews = postContract('setNull', { views: { ...integer, nullable: true } });

describe('a SQLite rebuild on a database already further along', {
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

  function run(planned: ReturnType<typeof plan>, contract: Contract<SqlStorage>) {
    const { driver } = testDb;
    return sqliteTargetDescriptor.createRunner(familyInstance).execute({
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
  }

  async function views() {
    return (await testDb.driver.query('SELECT id, views FROM "Post" ORDER BY id')).rows;
  }

  it('refuses the rebuild when the table has a column the rebuild does not know, and keeps its data', async () => {
    testDb = createTestDatabase();
    const created = await run(plan(null, withViews), withViews);
    if (!created.ok) throw new Error(formatRunnerFailure(created.failure));
    await testDb.driver.query('DELETE FROM _prisma_marker');
    await testDb.driver.query('INSERT INTO "User" (id) VALUES (1)');
    await testDb.driver.query('INSERT INTO "Post" (id, "authorId", views) VALUES (1, 1, 5)');

    const result = await run(plan(before, rebuilt, null), rebuilt);

    expect({
      failure: result.ok ? undefined : result.failure,
      views: await views(),
    }).toMatchObject({
      failure: {
        code: 'MIGRATION.PRECHECK_FAILED',
        message: expect.stringContaining('"Post"'),
      },
      views: [{ id: 1, views: 5 }],
    });
  });

  it('rebuilds a table whose columns are the ones it expects', async () => {
    testDb = createTestDatabase();
    const created = await run(plan(null, before), before);
    if (!created.ok) throw new Error(formatRunnerFailure(created.failure));
    await testDb.driver.query('INSERT INTO "User" (id) VALUES (1)');
    await testDb.driver.query('INSERT INTO "Post" (id, "authorId") VALUES (1, 1)');

    const result = await run(plan(before, rebuilt), rebuilt);

    expect({
      executed: result.ok ? result.value.perSpaceResults[0]?.value.operationsExecuted : undefined,
      rows: (await testDb.driver.query('SELECT id, "authorId" FROM "Post"')).rows,
    }).toEqual({ executed: 1, rows: [{ id: 1, authorId: 1 }] });
  });
});

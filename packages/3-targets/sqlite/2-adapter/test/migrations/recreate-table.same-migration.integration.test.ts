import { asNamespaceId, type Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import { timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_CLASSES, postModelContract } from './fixtures/recreate-contracts';
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

const NS = asNamespaceId(UNBOUND_NAMESPACE_ID);
const before = postModelContract({ onDelete: 'cascade' });

describe('a SQLite rebuild after other changes to its table in the same migration', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
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
      origin: planOriginOf(from),
      statements,
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

  async function migrate(
    destination: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    testDb = createTestDatabase();
    await execute(plan(null, before), before);
    await testDb.driver.query('INSERT INTO "User" (id) VALUES (1)');
    await testDb.driver.query(`INSERT INTO "Post" (id, "authorId", title) VALUES (1, 1, 'Hello')`);
    return execute(plan(before, destination, statements), destination);
  }

  async function onDelete(table: string) {
    return (await testDb.driver.query(`SELECT on_delete FROM pragma_foreign_key_list('${table}')`))
      .rows;
  }

  it('rebuilds a table an earlier operation added an optional column to', async () => {
    await migrate(postModelContract({ onDelete: 'setNull', optional: ['subtitle'] }));

    expect({
      rows: (await testDb.driver.query('SELECT id, "authorId", title, subtitle FROM "Post"')).rows,
      actions: await onDelete('Post'),
    }).toEqual({
      rows: [{ id: 1, authorId: 1, title: 'Hello', subtitle: null }],
      actions: [{ on_delete: 'SET NULL' }],
    });
  });

  it('rebuilds a table whose column an earlier operation renamed', async () => {
    await migrate(postModelContract({ onDelete: 'setNull', title: 'headline' }), [
      {
        kind: 'rename',
        entity: 'field',
        from: { namespaceId: NS, model: 'Post', field: 'title' },
        to: { namespaceId: NS, model: 'Post', field: 'headline' },
      },
    ]);

    expect({
      rows: (await testDb.driver.query('SELECT id, "authorId", headline FROM "Post"')).rows,
      actions: await onDelete('Post'),
    }).toEqual({
      rows: [{ id: 1, authorId: 1, headline: 'Hello' }],
      actions: [{ on_delete: 'SET NULL' }],
    });
  });

  it('rebuilds a table an earlier operation renamed', async () => {
    await migrate(postModelContract({ onDelete: 'setNull', table: 'Article' }), [
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: NS, model: 'Post' },
        to: { namespaceId: NS, model: 'Article' },
      },
    ]);

    expect({
      rows: (await testDb.driver.query('SELECT id, "authorId", title FROM "Article"')).rows,
      actions: await onDelete('Article'),
    }).toEqual({
      rows: [{ id: 1, authorId: 1, title: 'Hello' }],
      actions: [{ on_delete: 'SET NULL' }],
    });
  });
});

/**
 * The SQLite planner rewrites or deletes the rows of variants whose discriminator value changes or
 * that are removed, after every other change. Migrations run with foreign keys off, so a deleted
 * row that another table references fails the apply at PRAGMA foreign_key_check; the rows of a
 * variant's own table are deleted with its base rows, as its foreign key's cascade would.
 */
import type { Contract } from '@internal/contract/types';
import { asNamespaceId, crossRef } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  type ModelNode,
} from '@internal/sql-contract-ts/contract-builder';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import sqlitePack from '@internal/target-sqlite/pack';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const codecLookup = createSqliteBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(sqliteDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'sqlite/text@1' } as const;
const idField = { fieldName: 'id', columnName: 'id', descriptor: text, nullable: false };

/**
 * `Task` in table `tasks`, discriminated by `type`. Each entry of `shared` is a variant stored in
 * `tasks`; `Feature`, when `feature` is given, is a variant with its own table `features`.
 */
function tasksContract(input: {
  readonly shared: Readonly<Record<string, string>>;
  readonly feature?: string;
  readonly comments?: boolean;
}): Contract<SqlStorage> {
  const variants = {
    ...Object.fromEntries(
      Object.entries(input.shared).map(([model, value]) => [
        value,
        crossRef(model, UNBOUND_NAMESPACE_ID),
      ]),
    ),
    ...(input.feature === undefined
      ? {}
      : { [input.feature]: crossRef('Feature', UNBOUND_NAMESPACE_ID) }),
  };
  const models: ModelNode[] = [
    {
      modelName: 'Task',
      tableName: 'tasks',
      fields: [
        idField,
        { fieldName: 'type', columnName: 'type', descriptor: text, nullable: false },
      ],
      id: { columns: ['id'] },
      discriminator: { field: 'type' },
      variants,
    },
    ...Object.keys(input.shared).map(
      (modelName): ModelNode => ({
        modelName,
        tableName: 'tasks',
        fields: [],
        sharesBaseTable: true,
        base: crossRef('Task', UNBOUND_NAMESPACE_ID),
      }),
    ),
    ...(input.feature === undefined
      ? []
      : [
          {
            modelName: 'Feature',
            tableName: 'features',
            fields: [
              idField,
              { fieldName: 'priority', columnName: 'priority', descriptor: text, nullable: true },
            ],
            id: { columns: ['id'] },
            base: crossRef('Task', UNBOUND_NAMESPACE_ID),
            foreignKeys: [
              {
                columns: ['id'],
                references: { model: 'Task', table: 'tasks', columns: ['id'] },
                onDelete: 'cascade',
                constraint: true,
                index: false,
              },
            ],
          } satisfies ModelNode,
        ]),
    ...(input.comments === true
      ? [
          {
            modelName: 'Comment',
            tableName: 'comments',
            fields: [
              idField,
              { fieldName: 'taskId', columnName: 'task_id', descriptor: text, nullable: false },
            ],
            id: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['task_id'],
                references: { model: 'Task', table: 'tasks', columns: ['id'] },
                onDelete: 'cascade',
                constraint: true,
                index: false,
              },
            ],
          } satisfies ModelNode,
        ]
      : []),
  ];
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: sqlitePack,
      createNamespace: sqliteCreateNamespace,
      models,
    },
    codecLookup,
    dataTypeLookup,
  );
}

const app = asNamespaceId(UNBOUND_NAMESPACE_ID);
const origin = tasksContract({ shared: { Bug: 'bug', Epic: 'epic' }, feature: 'feature' });
const bug = { namespaceId: app, model: 'Bug' };

describe('SQLite planner, variant rows', { timeout: timeouts.databaseOperation }, () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb?.cleanup();
  });

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: testDb.driver, contract: from });
    return sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: from === null ? INIT_ADDITIVE_POLICY : FULL_POLICY,
      fromContract: from,
      origin: from === null ? null : planOriginOf(from),
      statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  async function apply(result: Awaited<ReturnType<typeof plan>>, contract: Contract<SqlStorage>) {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const { driver } = testDb;
    const executed = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver,
          destinationContract: contract,
          policy: FULL_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executed.ok) throw new Error(formatRunnerFailure(executed.failure));
  }

  async function start(contract: Contract<SqlStorage> = origin): Promise<void> {
    await apply(await plan(null, contract), contract);
    await testDb.driver.query(
      `INSERT INTO "tasks" (id, type) VALUES ('1', 'bug'), ('2', 'epic'), ('3', 'feature'), ('4', 'bug')`,
    );
    await testDb.driver.query(`INSERT INTO "features" (id, priority) VALUES ('3', 'high')`);
  }

  async function tasks(): Promise<unknown[]> {
    return (await testDb.driver.query('SELECT id, type FROM "tasks" ORDER BY id')).rows;
  }

  async function operationKinds(
    result: Awaited<ReturnType<typeof plan>>,
  ): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  it('rewrites the discriminator value of --convert Bug', async () => {
    const to = tasksContract({ shared: { Bug: 'defect', Epic: 'epic' }, feature: 'feature' });
    await start();

    const result = await plan(origin, to, [{ kind: 'convert', entity: 'model', model: bug }]);

    expect(await operationKinds(result)).toEqual(['replaceStoredValue']);
    await apply(result, to);
    expect(await tasks()).toEqual([
      { id: '1', type: 'defect' },
      { id: '2', type: 'epic' },
      { id: '3', type: 'feature' },
      { id: '4', type: 'defect' },
    ]);
  });

  it('rewrites the discriminator value of a renamed variant whose value changed', async () => {
    const to = tasksContract({ shared: { Defect: 'defect', Epic: 'epic' }, feature: 'feature' });
    await start();

    await apply(
      await plan(origin, to, [
        { kind: 'rename', entity: 'model', from: bug, to: { namespaceId: app, model: 'Defect' } },
      ]),
      to,
    );

    expect(await tasks()).toEqual([
      { id: '1', type: 'defect' },
      { id: '2', type: 'epic' },
      { id: '3', type: 'feature' },
      { id: '4', type: 'defect' },
    ]);
  });

  it('deletes the rows of a changed value with no statement', async () => {
    const to = tasksContract({ shared: { Bug: 'defect', Epic: 'epic' }, feature: 'feature' });
    await start();

    await apply(await plan(origin, to), to);

    expect(await tasks()).toEqual([
      { id: '2', type: 'epic' },
      { id: '3', type: 'feature' },
    ]);
  });

  it("deletes the rows of a changed value of a variant with its own table, first in that table, as its foreign key's cascade would", async () => {
    const to = tasksContract({ shared: { Bug: 'bug', Epic: 'epic' }, feature: 'story' });
    await start();
    await testDb.driver.query(`INSERT INTO "tasks" (id, type) VALUES ('5', 'feature')`);
    await testDb.driver.query(`INSERT INTO "features" (id, priority) VALUES ('5', NULL)`);

    await apply(await plan(origin, to), to);

    expect([
      await tasks(),
      (await testDb.driver.query('SELECT id FROM "features" ORDER BY id')).rows,
    ]).toEqual([
      [
        { id: '1', type: 'bug' },
        { id: '2', type: 'epic' },
        { id: '4', type: 'bug' },
      ],
      [],
    ]);
  });

  it('drops the table of a removed variant, then deletes its base rows', async () => {
    const to = tasksContract({ shared: { Bug: 'bug', Epic: 'epic' } });
    await start();

    const result = await plan(origin, to);

    expect(await operationKinds(result)).toEqual(['dropTable', 'deleteRows']);
    await apply(result, to);
    expect(await tasks()).toEqual([
      { id: '1', type: 'bug' },
      { id: '2', type: 'epic' },
      { id: '4', type: 'bug' },
    ]);
  });

  it('fails the apply at the foreign key check when another table references a deleted row', async () => {
    const from = tasksContract({
      shared: { Bug: 'bug', Epic: 'epic' },
      feature: 'feature',
      comments: true,
    });
    const to = tasksContract({ shared: { Epic: 'epic' }, feature: 'feature', comments: true });
    await start(from);
    await testDb.driver.query(`INSERT INTO "comments" (id, task_id) VALUES ('c1', '1')`);

    const result = await plan(from, to);

    await expect(apply(result, to)).rejects.toThrow(
      'MIGRATION.FOREIGN_KEY_VIOLATION] Foreign key integrity check failed after migration: 1 violation(s).\n  why: PRAGMA foreign_key_check reported violations after the migration ran with foreign keys off: 1 row of "comments" references "tasks" rows that a recreate-table or deleteRows operation removed, and no cascade ran. Delete or change the referencing rows first. The failed apply changed nothing.',
    );
    expect(await tasks()).toEqual([
      { id: '1', type: 'bug' },
      { id: '2', type: 'epic' },
      { id: '3', type: 'feature' },
      { id: '4', type: 'bug' },
    ]);
  });
});

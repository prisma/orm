/**
 * The Postgres planner rewrites or deletes the rows of variants whose discriminator value changes or
 * that are removed, between the drop of the old discriminator check and the creation of the new
 * one, which then accepts every row.
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
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  buildSqlContractFromDefinition,
  type ModelNode,
} from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const codecLookup = createPostgresBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'pg/text@1' } as const;
const idField = { fieldName: 'id', columnName: 'id', descriptor: text, nullable: false };

/**
 * `Task` in table `tasks`, discriminated by `type`. Each entry of `shared` is a variant stored in
 * `tasks`; `Feature`, when `feature` is given, is a variant with its own table `features`.
 */
function tasksContract(input: {
  readonly shared: Readonly<Record<string, string>>;
  readonly feature?: string;
}): Contract<SqlStorage> {
  const variants = {
    ...Object.fromEntries(
      Object.entries(input.shared).map(([model, value]) => [value, crossRef(model, 'public')]),
    ),
    ...(input.feature === undefined ? {} : { [input.feature]: crossRef('Feature', 'public') }),
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
        base: crossRef('Task', 'public'),
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
            base: crossRef('Task', 'public'),
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
  ];
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      models,
    },
    codecLookup,
    dataTypeLookup,
  );
}

const publicId = asNamespaceId('public');
const origin = tasksContract({ shared: { Bug: 'bug', Epic: 'epic' }, feature: 'feature' });

describe('Postgres planner, variant rows', { concurrent: false }, () => {
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
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
  }, testTimeout);

  const planner = () => postgresTargetDescriptor.createPlanner(controlAdapter);

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null ? emptySchema : await familyInstance.introspect({ driver, contract: from });
    return planner().plan({
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
    const executed = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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

  async function start(): Promise<void> {
    await apply(await plan(null, origin), origin);
    await driver.query(
      `insert into "tasks" (id, type) values ('1', 'bug'), ('2', 'epic'), ('3', 'feature'), ('4', 'bug')`,
    );
    await driver.query(`insert into "features" (id, priority) values ('3', 'high')`);
  }

  async function tasks(): Promise<unknown[]> {
    return (await driver.query('select id, type from "tasks" order by id')).rows;
  }

  async function operationKinds(
    result: Awaited<ReturnType<typeof plan>>,
  ): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  it('rewrites the discriminator value of --convert Bug between the old and new checks', {
    timeout: testTimeout,
  }, async () => {
    const to = tasksContract({ shared: { Bug: 'defect', Epic: 'epic' }, feature: 'feature' });
    await start();

    const result = await plan(origin, to, [
      { kind: 'convert', entity: 'model', model: { namespaceId: publicId, model: 'Bug' } },
    ]);

    expect(await operationKinds(result)).toEqual([
      'dropCheckConstraint',
      'replaceStoredValue',
      'checkConstraint',
    ]);
    await apply(result, to);
    expect(await tasks()).toEqual([
      { id: '1', type: 'defect' },
      { id: '2', type: 'epic' },
      { id: '3', type: 'feature' },
      { id: '4', type: 'defect' },
    ]);
    expect(await operationKinds(await plan(to, to))).toEqual([]);
  });

  it('rewrites the discriminator value of a renamed variant whose value changed', {
    timeout: testTimeout,
  }, async () => {
    const to = tasksContract({ shared: { Defect: 'defect', Epic: 'epic' }, feature: 'feature' });
    await start();

    await apply(
      await plan(origin, to, [
        {
          kind: 'rename',
          entity: 'model',
          from: { namespaceId: publicId, model: 'Bug' },
          to: { namespaceId: publicId, model: 'Defect' },
        },
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

  it('deletes the rows of a changed value with no statement', {
    timeout: testTimeout,
  }, async () => {
    const to = tasksContract({ shared: { Bug: 'defect', Epic: 'epic' }, feature: 'feature' });
    await start();

    await apply(await plan(origin, to), to);

    expect(await tasks()).toEqual([
      { id: '2', type: 'epic' },
      { id: '3', type: 'feature' },
    ]);
  });

  it('drops the table of a removed variant and deletes its base rows', {
    timeout: testTimeout,
  }, async () => {
    const to = tasksContract({ shared: { Bug: 'bug', Epic: 'epic' } });
    await start();

    const result = await plan(origin, to);

    expect(await operationKinds(result)).toEqual([
      'dropTable',
      'dropCheckConstraint',
      'deleteRows',
      'checkConstraint',
    ]);
    await apply(result, to);
    expect(await tasks()).toEqual([
      { id: '1', type: 'bug' },
      { id: '2', type: 'epic' },
      { id: '4', type: 'bug' },
    ]);
  });

  it('deletes the rows of a variant with its own table through the cascade of its foreign key', {
    timeout: testTimeout,
  }, async () => {
    const to = tasksContract({ shared: { Bug: 'bug', Epic: 'epic' }, feature: 'request' });
    await start();

    await apply(await plan(origin, to), to);

    expect([await tasks(), (await driver.query('select id from "features"')).rows]).toEqual([
      [
        { id: '1', type: 'bug' },
        { id: '2', type: 'epic' },
        { id: '4', type: 'bug' },
      ],
      [],
    ]);
  });
});

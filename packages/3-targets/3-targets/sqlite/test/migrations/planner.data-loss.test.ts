import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { CodecControlHooks } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { expectDataLossMatchesDestructive } from '@repo/test-utils/data-loss-expectations';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { HANDLE_INDEX_HASH, handleIndex, stubLowerer } from './rename-table-fixtures';

const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);
const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

const columnTypes = {
  text: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
  integer: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
  'text?': { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: true },
} as const;

type ColumnType = keyof typeof columnTypes;

/** A model per table, each field stored in the column of the same name. */
function contract(
  seed: string,
  tables: Readonly<Record<string, Readonly<Record<string, ColumnType>>>>,
  indexed: ReadonlySet<string> = new Set(),
): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: Object.fromEntries(
              Object.entries(tables).map(([table, columns]) => [
                table,
                new StorageTable({
                  columns: Object.fromEntries(
                    Object.entries(columns).map(([column, type]) => [column, columnTypes[type]]),
                  ),
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: indexed.has(table) ? [handleIndex(table)] : [],
                  foreignKeys: [],
                }),
              ]),
            ),
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({
      models: Object.fromEntries(
        Object.entries(tables).map(([table, columns]) => [
          table,
          {
            fields: Object.fromEntries(
              Object.keys(columns).map((column) => [
                column,
                { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/text@1' } },
              ]),
            ),
            relations: {},
            storage: {
              table,
              namespaceId: UNBOUND_NAMESPACE_ID,
              fields: Object.fromEntries(
                Object.keys(columns).map((column) => [column, { column }]),
              ),
            },
          },
        ]),
      ),
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

async function planned(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  options: {
    readonly fromContract?: Contract<SqlStorage> | null;
    readonly statements?: readonly ResolvedMigrationStatement[];
  } = {},
) {
  const fromContract = options.fromContract === undefined ? from : options.fromContract;
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy: ALL_CLASSES,
    fromContract,
    origin: planOriginOf(fromContract),
    statements: options.statements ?? [],
    frameworkComponents: sqliteTestComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  const operations = await Promise.all(result.plan.operations);
  const originModel = (table: string) =>
    (options.statements ?? []).find(
      (statement) => statement.entity === 'model' && statement.to.model === table,
    )?.from.model ?? table;
  expectDataLossMatchesDestructive(result, operations, {
    subjectOf: ({ target }) =>
      target.details?.objectType === 'column' && target.details.table !== undefined
        ? {
            kind: 'field',
            namespaceId: unbound,
            model: originModel(target.details.table),
            field: target.details.name,
          }
        : undefined,
  });
  const labels = operations.map((op) => op.label);
  return {
    labels,
    dataLoss: result.dataLoss.map(({ operationIndex, subject }) => ({
      operation: labels[operationIndex],
      subject,
    })),
    accessWidening: result.accessWidening,
    classes: Object.fromEntries(operations.map((op) => [op.label, op.operationClass])),
  };
}

describe('SQLite planner, data loss', () => {
  it('names the model of a dropped table and the field of a dropped column', async () => {
    const from = contract('from', {
      Legacy: { id: 'integer' },
      User: { id: 'integer', email: 'text', nickname: 'text' },
    });
    const to = contract('to', { User: { id: 'integer', email: 'text' } });

    const { dataLoss, accessWidening } = await planned(from, to);
    expect({ dataLoss, accessWidening }).toEqual({
      dataLoss: [
        {
          operation: 'Drop column nickname on User',
          subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
        },
        {
          operation: 'Drop table Legacy',
          subject: { kind: 'model', namespaceId: unbound, model: 'Legacy' },
        },
      ],
      accessWidening: [],
    });
  });

  it('names the field whose type a recreate changes, at the recreate', async () => {
    const from = contract('from', { User: { id: 'integer', age: 'text' } });
    const to = contract('to', { User: { id: 'integer', age: 'integer' } });

    expect((await planned(from, to)).dataLoss).toEqual([
      {
        operation: 'Recreate table User',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'age' },
      },
    ]);
  });

  it('names a column a recreate leaves out once, at the recreate, which is destructive', async () => {
    const from = contract('from', { User: { id: 'integer', email: 'text?', nickname: 'text' } });
    const to = contract('to', { User: { id: 'integer', email: 'text' } });
    const result = await planned(from, to);

    expect(result.classes['Recreate table User']).toBe('destructive');
    expect(result.dataLoss).toEqual([
      {
        operation: 'Recreate table User',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
      },
    ]);
  });

  it('names storage by the names the database has when the plan has no origin contract', async () => {
    const from = contract('from', {
      Legacy: { id: 'integer' },
      User: { id: 'integer', email: 'text', nickname: 'text' },
    });
    const to = contract('to', { User: { id: 'integer', email: 'text' } });

    expect((await planned(from, to, { fromContract: null })).dataLoss).toEqual([
      {
        operation: 'Drop column nickname on User',
        subject: { kind: 'storage', name: 'User.nickname' },
      },
      { operation: 'Drop table Legacy', subject: { kind: 'storage', name: 'Legacy' } },
    ]);
  });

  it('names the origin model and fields of a table a statement renamed earlier in the plan', async () => {
    const from = contract(
      'from',
      { User: { id: 'integer', handle: 'text', nickname: 'text', age: 'text' } },
      new Set(['User']),
    );
    const to = contract(
      'to',
      { Account: { id: 'integer', handle: 'text', age: 'integer' } },
      new Set(['Account']),
    );
    const renameUser: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'model',
      from: { namespaceId: unbound, model: 'User' },
      to: { namespaceId: unbound, model: 'Account' },
    };

    const result = await planned(from, to, { statements: [renameUser] });

    expect(result.labels).toEqual([
      'Rename table User to Account',
      `Drop index User_handle_idx_${HANDLE_INDEX_HASH} on Account`,
      `Create index Account_handle_idx_${HANDLE_INDEX_HASH} on Account`,
      'Recreate table Account',
      'Drop column nickname on Account',
    ]);
    expect(result.dataLoss).toEqual([
      {
        operation: 'Recreate table Account',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
      },
      {
        operation: 'Recreate table Account',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'age' },
      },
    ]);
  });
});

/** A codec hook that adds an operation for every field it is told was added. */
function withAddedFieldHook(components: typeof sqliteTestComponents): typeof sqliteTestComponents {
  const hooks: CodecControlHooks = {
    onFieldEvent: (event, ctx) =>
      event === 'added'
        ? [
            {
              factoryName: 'codecAdded',
              operationClass: 'additive',
              label: `Codec hook for added ${ctx.tableName}.${ctx.fieldName}`,
              renderTypeScript: () => 'codecAdded()',
              importRequirements: () => [],
              toOp: () => ({
                id: `codec.added.${ctx.tableName}.${ctx.fieldName}`,
                label: `Codec hook for added ${ctx.tableName}.${ctx.fieldName}`,
                operationClass: 'additive',
                target: { id: 'sqlite' },
                precheck: [],
                execute: [],
                postcheck: [],
              }),
            },
          ]
        : [],
  };
  return [
    ...components,
    {
      kind: 'adapter',
      id: 'field-event-hook',
      familyId: 'sql',
      targetId: 'sqlite',
      version: '0.0.0',
      types: { codecTypes: { controlPlaneHooks: { 'sqlite/text@1': hooks } } },
    } as (typeof components)[number],
  ];
}

describe('SQLite planner under db update', () => {
  async function dbUpdatePlan(
    from: Contract<SqlStorage>,
    to: Contract<SqlStorage>,
    fromContract: Contract<SqlStorage> | null,
  ) {
    const result = createSqliteMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: sqliteContractToSchema(from, sqliteTestTypes),
      policy: ALL_CLASSES,
      fromContract,
      origin: null,
      statements: [],
      frameworkComponents: withAddedFieldHook(sqliteTestComponents),
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = (await Promise.all(result.plan.operations)).map(
      ({ id, label, operationClass }) => ({ id, label, operationClass }),
    );
    return { origin: result.plan.origin, operations };
  }

  it('plans the same operations with and without the origin contract, codec field-event hooks included, and asserts no origin', async () => {
    const from = contract('from', {
      Legacy: { id: 'integer' },
      User: { id: 'integer', email: 'text?', nickname: 'text', age: 'text' },
    });
    const to = contract('to', { User: { id: 'integer', email: 'text', age: 'integer' } });

    const withOrigin = await dbUpdatePlan(from, to, from);
    const without = await dbUpdatePlan(from, to, null);

    expect(withOrigin).toEqual(without);
    expect(withOrigin.origin).toBeNull();
    expect(withOrigin.operations.length).toBeGreaterThan(0);
  });
});

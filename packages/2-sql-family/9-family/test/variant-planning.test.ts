import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  ResolvedModelRenameStatement,
  ResolvedVariantConvertStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import { planVariantRowRewrites } from '../src/core/migrations/variant-planning';

const app = asNamespaceId('app');
const text = { kind: 'scalar', codecId: 'test/text@1' } as const;

/** `Task` in table `tasks`, discriminated by `type`, with one variant per entry of `variants`; `Bug`, with `bugs`, in table `bugs` whose foreign key to `tasks` has that `onDelete`. */
function tasks(
  variants: Readonly<Record<string, string>>,
  bugs?: { readonly onDelete: 'cascade' | 'restrict' },
): Contract<SqlStorage> {
  const variantModels: Record<string, ContractModelBase> = Object.fromEntries(
    Object.values(variants).map((model) => [
      model,
      {
        fields: {},
        relations: {},
        base: { namespace: app, model: 'Task' },
        storage: {
          table: bugs !== undefined && model === 'Bug' ? 'bugs' : 'tasks',
          namespaceId: 'app',
          fields: {},
        },
      },
    ]),
  );
  const idColumn = { dataType: 'test/text', codecId: 'test/text@1', nullable: false };
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        app: createTestSqlNamespace({
          id: 'app',
          entries: {
            table: {
              tasks: new StorageTable({
                columns: {
                  id: { dataType: 'test/text', codecId: 'test/text@1', nullable: false },
                  type: { dataType: 'test/text', codecId: 'test/text@1', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
              ...(bugs === undefined
                ? {}
                : {
                    bugs: new StorageTable({
                      columns: { task_id: idColumn },
                      uniques: [],
                      indexes: [],
                      foreignKeys: [
                        {
                          source: { namespaceId: 'app', tableName: 'bugs', columns: ['task_id'] },
                          target: { namespaceId: 'app', tableName: 'tasks', columns: ['id'] },
                          onDelete: bugs.onDelete,
                          index: { primaryKey: true },
                        },
                      ],
                    }),
                  }),
            },
          },
        }),
      },
    }),
    domain: {
      namespaces: {
        app: {
          models: {
            Task: {
              fields: {
                id: { nullable: false, type: text },
                type: { nullable: false, type: text },
              },
              relations: {},
              discriminator: { field: 'type' },
              variants: Object.fromEntries(
                Object.entries(variants).map(([value, model]) => [
                  value,
                  { namespace: app, model },
                ]),
              ),
              storage: {
                table: 'tasks',
                namespaceId: 'app',
                fields: { id: { column: 'id' }, type: { column: 'type' } },
              },
            },
            ...variantModels,
          },
        },
      },
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const allTables: SchemaTables = {
  hasTable: () => true,
  hasColumn: () => true,
  tablesNamed: () => [],
  columnsNamed: () => [],
  namespacesWithTable: () => [],
  hasNamespace: () => true,
};

const origin = tasks({ bug: 'Bug', epic: 'Epic' });
const bug = { namespaceId: app, model: 'Bug' };
const column = {
  namespaceId: 'app',
  table: 'tasks',
  column: 'type',
  codecRef: { codecId: 'test/text@1' },
};

function plan(
  contract: Contract<SqlStorage>,
  statements: readonly (ResolvedModelRenameStatement | ResolvedVariantConvertStatement)[] = [],
) {
  const result = planVariantRowRewrites({
    statements,
    fromContract: origin,
    contract,
    tables: allTables,
  });
  if (!result.ok) throw new Error(`expected rewrites, got: ${result.failure.summary}`);
  return result.value;
}

describe('planVariantRowRewrites', () => {
  it('rewrites a changed discriminator value for --convert', () => {
    const convert: ResolvedVariantConvertStatement = {
      kind: 'convert',
      entity: 'model',
      model: bug,
    };
    expect(plan(tasks({ defect: 'Bug', epic: 'Epic' }), [convert])).toEqual([
      { model: bug, ...column, from: 'bug', to: 'defect', removed: false, statement: convert },
    ]);
  });

  it('rewrites the value for a rename whose value changed', () => {
    const rename: ResolvedModelRenameStatement = {
      kind: 'rename',
      entity: 'model',
      from: bug,
      to: { namespaceId: app, model: 'Defect' },
    };
    expect(plan(tasks({ defect: 'Defect', epic: 'Epic' }), [rename])).toEqual([
      { model: bug, ...column, from: 'bug', to: 'defect', removed: false, statement: rename },
    ]);
  });

  it('plans nothing for a rename whose value did not change', () => {
    const rename: ResolvedModelRenameStatement = {
      kind: 'rename',
      entity: 'model',
      from: bug,
      to: { namespaceId: app, model: 'Defect' },
    };
    expect(plan(tasks({ bug: 'Defect', epic: 'Epic' }), [rename])).toEqual([]);
  });

  it('deletes the rows of a changed value with no statement', () => {
    expect(plan(tasks({ defect: 'Bug', epic: 'Epic' }))).toEqual([
      { model: bug, ...column, from: 'bug', to: undefined, removed: false, statement: undefined },
    ]);
  });

  it("names the variant's own table when its foreign key to the base table cascades", () => {
    expect(
      [
        tasks({ defect: 'Bug', epic: 'Epic' }, { onDelete: 'cascade' }),
        tasks({ defect: 'Bug', epic: 'Epic' }, { onDelete: 'restrict' }),
      ].map((contract) => plan(contract).map(({ variantTable }) => variantTable)),
    ).toEqual([
      [{ namespaceId: 'app', table: 'bugs', columns: ['task_id'], references: ['id'] }],
      [undefined],
    ]);
  });

  it('deletes the rows of a removed variant', () => {
    expect(plan(tasks({ epic: 'Epic' }))).toEqual([
      { model: bug, ...column, from: 'bug', to: undefined, removed: true, statement: undefined },
    ]);
  });

  it('plans nothing when the variants keep their values', () => {
    expect(plan(origin)).toEqual([]);
  });

  it('plans nothing when the working schema has no discriminator column', () => {
    const result = planVariantRowRewrites({
      statements: [],
      fromContract: origin,
      contract: tasks({ epic: 'Epic' }),
      tables: { ...allTables, hasColumn: () => false },
    });
    expect(result.ok ? result.value : result.failure).toEqual([]);
  });

  it('deletes before it rewrites, so a freed value can be taken', () => {
    const convert: ResolvedVariantConvertStatement = {
      kind: 'convert',
      entity: 'model',
      model: { namespaceId: app, model: 'Epic' },
    };
    expect(plan(tasks({ bug: 'Epic' }), [convert]).map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 'bug', to: undefined },
      { from: 'epic', to: 'bug' },
    ]);
  });

  it('refuses a rewrite to a value another variant moves from', () => {
    const converts: ResolvedVariantConvertStatement[] = [
      { kind: 'convert', entity: 'model', model: bug },
      { kind: 'convert', entity: 'model', model: { namespaceId: app, model: 'Epic' } },
    ];
    const result = planVariantRowRewrites({
      statements: converts,
      fromContract: origin,
      contract: tasks({ epic: 'Bug', bug: 'Epic' }),
      tables: allTables,
    });
    expect(result.ok ? undefined : result.failure.summary).toContain(
      'Cannot rewrite discriminator value "bug" of variant "Bug" to "epic"',
    );
  });

  it('plans nothing without an origin contract', () => {
    const result = planVariantRowRewrites({
      statements: [],
      fromContract: null,
      contract: origin,
      tables: allTables,
    });
    expect(result.ok ? result.value : result.failure).toEqual([]);
  });
});

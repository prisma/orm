import { asNamespaceId } from '@internal/contract/types';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import { describe, expect, it } from 'vitest';
import { mergeTables } from '../src/merge-tables';
import type { ColumnDescription, ModelStorage, TableDescription } from '../src/storage-description';
import { columnIndex } from './table-node-helpers';

function column(modelName: string, columnName: string, nullable = true): ColumnDescription {
  return {
    columnName,
    descriptor: { codecId: 'pg/text@1' },
    nullable,
    many: false,
    default: undefined,
    enumTypeHandle: undefined,
    valueObject: undefined,
    site: { kind: 'field', modelName, fieldName: columnName },
  };
}

function table(
  tableName: string,
  columns: readonly ColumnDescription[],
  namespaceId = 'public',
): TableDescription {
  return {
    namespaceId,
    tableName,
    columns,
    control: undefined,
    id: undefined,
    uniques: [],
    indexes: [],
    checks: [],
    foreignKeys: [],
  };
}

function ownTable(description: TableDescription): ModelStorage {
  return { kind: 'ownTable', modelName: 'Model', table: description };
}

function baseTable(
  modelName: string,
  tableName: string,
  columns: readonly ColumnDescription[],
  constraints: Partial<Pick<TableDescription, 'uniques' | 'indexes' | 'foreignKeys'>> = {},
): ModelStorage {
  return {
    kind: 'baseTable',
    modelName,
    namespaceId: 'public',
    tableName,
    columns,
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...constraints,
  };
}

function foreignKey(columnName: string, targetTable: string): ForeignKeyAuthoringInput {
  return {
    source: { namespaceId: asNamespaceId('public'), tableName: 'task', columns: [columnName] },
    target: { namespaceId: asNamespaceId('public'), tableName: targetTable, columns: ['id'] },
    constraint: true,
    index: true,
  };
}

describe('mergeTables', () => {
  it('keeps one table per namespace and table name, in model order', () => {
    const task = table('task', [column('Task', 'id')]);
    const auditTask = table('task', [column('Task', 'id')], 'audit');
    const user = table('user', [column('User', 'id')]);

    expect(mergeTables([ownTable(task), ownTable(user), ownTable(auditTask)], [])).toEqual([
      task,
      user,
      auditTask,
    ]);
  });

  it('refuses two tables with the same name in one namespace', () => {
    expect(() =>
      mergeTables(
        [
          ownTable(table('task', [column('Task', 'id')])),
          ownTable(table('task', [column('Job', 'id')])),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_DUPLICATE',
        meta: { kind: 'table', name: 'task', namespaceId: 'public' },
      }),
    );
  });

  it('keeps the base table as it is when a variant column is already on it', () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'severity')]);

    expect(
      mergeTables(
        [ownTable(task), baseTable('Bug', 'task', [column('Bug', 'severity', false)])],
        [],
      ),
    ).toEqual([task]);
  });

  it("adds a variant's partial indexes and foreign keys to the base table", () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
    const constraints = {
      indexes: [
        { ...columnIndex(['ownerId']), where: "kind = 'bug'" },
        { ...columnIndex(['ownerId']), where: "kind = 'bug'", unique: true },
      ],
      foreignKeys: [foreignKey('ownerId', 'user')],
    } satisfies Partial<TableDescription>;

    expect(
      mergeTables(
        [ownTable(task), baseTable('Bug', 'task', [column('Bug', 'ownerId')], constraints)],
        [],
      ),
    ).toEqual([{ ...task, ...constraints }]);
  });

  it('merges the same foreign key declared by two variants', () => {
    const task = table('task', [column('Task', 'id'), column('Task', 'ownerId')]);
    const constraints = { foreignKeys: [foreignKey('ownerId', 'user')] };

    expect(
      mergeTables(
        [
          ownTable(task),
          baseTable('Bug', 'task', [column('Bug', 'ownerId')], constraints),
          baseTable('Feature', 'task', [column('Feature', 'ownerId')], constraints),
        ],
        [],
      ),
    ).toEqual([{ ...task, ...constraints }]);
  });

  it.each([
    {
      case: 'two variants',
      task: table('task', [column('Task', 'id'), column('Task', 'ownerId')]),
      other: 'Bug',
    },
    {
      case: 'the base model and a variant',
      task: {
        ...table('task', [column('Task', 'id'), column('Task', 'ownerId')]),
        foreignKeys: [foreignKey('ownerId', 'team')],
      },
      other: 'Model',
    },
  ])('refuses foreign keys on one column to different targets from $case', ({ task, other }) => {
    const variants =
      other === 'Bug'
        ? [
            baseTable('Bug', 'task', [column('Bug', 'ownerId')], {
              foreignKeys: [foreignKey('ownerId', 'team')],
            }),
          ]
        : [];

    expect(() =>
      mergeTables(
        [
          ownTable(task),
          ...variants,
          baseTable('Feature', 'task', [column('Feature', 'ownerId')], {
            foreignKeys: [foreignKey('ownerId', 'user')],
          }),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message: expect.stringContaining(`"Feature" and "${other}"`),
        meta: {
          modelName: 'Feature',
          otherModelName: other,
          namespaceId: 'public',
          tableName: 'task',
          columns: ['ownerId'],
        },
      }),
    );
  });

  it('refuses every unique and every index without a condition on a variant', () => {
    const task = table('task', [
      column('Task', 'id'),
      column('Task', 'email'),
      column('Task', 'code'),
    ]);

    expect(() =>
      mergeTables(
        [
          ownTable(task),
          baseTable('Bug', 'task', [column('Bug', 'email'), column('Bug', 'code')], {
            uniques: [{ columns: ['email'] }],
            indexes: [
              columnIndex(['code']),
              { ...columnIndex(['code']), unique: true },
              { ...columnIndex(['email']), where: "kind = 'bug'" },
            ],
          }),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.UNSCOPED_INDEX_ON_STI_VARIANT',
        meta: {
          modelName: 'Bug',
          namespaceId: 'public',
          tableName: 'task',
          unscoped: [['email'], ['code'], ['code']],
        },
      }),
    );
  });

  it('adds nothing for a variant whose base table no model owns', () => {
    const user = table('user', [column('User', 'id')]);

    expect(
      mergeTables([ownTable(user), baseTable('Bug', 'task', [column('Bug', 'severity')])], []),
    ).toEqual([user]);
  });

  it('refuses a variant column the base table does not have', () => {
    expect(() =>
      mergeTables(
        [
          ownTable(table('task', [column('Task', 'id')])),
          baseTable('Bug', 'task', [column('Bug', 'severity')]),
        ],
        [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.VARIANT_COLUMN_NOT_ON_BASE_TABLE',
        meta: {
          modelName: 'Bug',
          namespaceId: 'public',
          tableName: 'task',
          columnName: 'severity',
        },
      }),
    );
  });
});

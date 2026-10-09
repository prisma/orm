import { describe, expect, it } from 'vitest';
import { mergeTables } from '../src/merge-tables';
import type { ColumnDescription, ModelStorage, TableDescription } from '../src/storage-description';

function column(modelName: string, columnName: string, nullable = true): ColumnDescription {
  return {
    columnName,
    descriptor: { codecId: 'pg/text@1' },
    nullable,
    many: false,
    default: undefined,
    noCheck: undefined,
    enumTypeHandle: undefined,
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
): ModelStorage {
  return { kind: 'baseTable', modelName, namespaceId: 'public', tableName, columns };
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

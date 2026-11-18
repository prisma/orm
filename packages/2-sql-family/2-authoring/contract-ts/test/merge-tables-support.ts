import { asNamespaceId } from '@internal/contract/types';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import type { ColumnDescription, ModelStorage, TableDescription } from '../src/storage-description';

export function column(modelName: string, columnName: string, nullable = true): ColumnDescription {
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

export function table(
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

export function ownTable(description: TableDescription): ModelStorage {
  return { kind: 'ownTable', modelName: 'Model', table: description };
}

export function baseTable(
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

export function foreignKey(columnName: string, targetTable: string): ForeignKeyAuthoringInput {
  return {
    source: { namespaceId: asNamespaceId('public'), tableName: 'task', columns: [columnName] },
    target: { namespaceId: asNamespaceId('public'), tableName: targetTable, columns: ['id'] },
    constraint: true,
    index: true,
  };
}

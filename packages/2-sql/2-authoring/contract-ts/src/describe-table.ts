import type { EnumTypeHandle } from '@internal/contract-authoring';
import type { ColumnSite } from './column-site';
import type { ColumnNode, TableNode } from './contract-definition';
import { type ForeignKeyResolutionContext, resolveForeignKey } from './resolve-foreign-key';
import type { ColumnDescription, TableDescription } from './storage-description';

/** Describes one column node. A model field passes its enum, which a column node alone cannot carry. */
export function describeColumn(
  column: ColumnNode,
  site: ColumnSite,
  domainEnum: EnumTypeHandle | undefined,
): ColumnDescription {
  return {
    columnName: column.columnName,
    descriptor: column.descriptor,
    nullable: column.nullable,
    many: column.many === true ? { elementNullable: column.elementNullable === true } : false,
    default: column.default,
    noCheck: column.noCheck,
    domainEnum,
    site,
  };
}

export function tableNodeNamespaceId(table: TableNode, defaultNamespaceId: string): string {
  return table.namespaceId !== undefined && table.namespaceId.length > 0
    ? table.namespaceId
    : defaultNamespaceId;
}

/** Describes a table node: its columns, and its foreign keys resolved against the definition's models and tables. */
export function describeTableNode(
  table: TableNode,
  context: ForeignKeyResolutionContext,
): TableDescription {
  const namespaceId = tableNodeNamespaceId(table, context.defaultNamespaceId);
  const { tableName } = table;
  const owner = { kind: 'table', tableName } as const;
  return {
    namespaceId,
    tableName,
    columns: table.columns.map((column) =>
      describeColumn(
        column,
        { kind: 'column', namespaceId, tableName, columnName: column.columnName },
        undefined,
      ),
    ),
    control: table.control,
    primaryKey: table.id,
    uniques: table.uniques ?? [],
    indexes: table.indexes ?? [],
    checks: table.checks ?? [],
    foreignKeys: (table.foreignKeys ?? []).map((fk) =>
      resolveForeignKey(fk, { namespaceId, tableName, owner }, context),
    ),
  };
}

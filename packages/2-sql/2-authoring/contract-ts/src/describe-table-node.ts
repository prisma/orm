import type { TableNode } from './contract-definition';
import { describeColumn } from './describe-column';
import { namespaceIdOrDefault } from './namespace-id';
import { type ForeignKeyResolutionContext, resolveForeignKey } from './resolve-foreign-key';
import type { TableDescription } from './storage-description';

/** Describes a table node: its columns, and its foreign keys resolved against the definition's models and tables. */
export function describeTableNode(
  table: TableNode,
  context: ForeignKeyResolutionContext,
): TableDescription {
  const namespaceId = namespaceIdOrDefault(table.namespaceId, context.defaultNamespaceId);
  const { tableName } = table;
  const owner = { kind: 'tableNode', namespaceId, tableName } as const;
  return {
    namespaceId,
    tableName,
    columns: table.columns.map((column) =>
      describeColumn(column, {
        kind: 'tableNode',
        namespaceId,
        tableName,
        columnName: column.columnName,
      }),
    ),
    id: table.id,
    uniques: table.uniques ?? [],
    indexes: table.indexes ?? [],
    checks: table.checks ?? [],
    foreignKeys: (table.foreignKeys ?? []).map((fk) =>
      resolveForeignKey(fk, { namespaceId, tableName, owner }, context),
    ),
    control: table.control,
  };
}

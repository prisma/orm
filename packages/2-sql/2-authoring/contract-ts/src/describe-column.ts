import type { ColumnNode } from './contract-definition';
import type { ColumnSite } from './declaration-sites';
import type { ColumnDescription } from './storage-description';

/** Describes one column, declared by a model's field or by a table node. */
export function describeColumn(column: ColumnNode, site: ColumnSite): ColumnDescription {
  return {
    columnName: column.columnName,
    descriptor: column.descriptor,
    nullable: column.nullable,
    many: column.many === true ? { elementNullable: column.elementNullable === true } : false,
    default: column.default,
    noCheck: column.noCheck,
    enumTypeHandle: column.enumTypeHandle,
    site,
  };
}

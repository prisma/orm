import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { resolveUniqueKeyColumnSets } from '../collection-contract';
import type { AliasedTable } from '../table-scope';

export function pinsUniqueKey(
  contract: Contract<SqlStorage>,
  table: AliasedTable,
  where: AnyExpression | undefined,
): boolean {
  const pinned = new Set(conjunctsOf(where).flatMap((expr) => pinnedColumns(table.alias, expr)));
  const { namespaceId, tableName } = table.storage;
  return resolveUniqueKeyColumnSets(contract, namespaceId, tableName).some((key) =>
    key.every((column) => pinned.has(column)),
  );
}

function conjunctsOf(where: AnyExpression | undefined): readonly AnyExpression[] {
  if (where === undefined) {
    return [];
  }
  return where.kind === 'and' ? where.exprs.flatMap(conjunctsOf) : [where];
}

function pinnedColumns(alias: string, expr: AnyExpression): string[] {
  if (expr.kind !== 'binary' || expr.op !== 'eq') {
    return [];
  }
  return [
    [expr.left, expr.right],
    [expr.right, expr.left],
  ].flatMap(([column, value]) =>
    column?.kind === 'column-ref' && column.table === alias && isValue(value)
      ? [column.column]
      : [],
  );
}

function isValue(expr: AnyExpression | undefined): boolean {
  return expr?.kind === 'param-ref' || (expr?.kind === 'literal' && expr.value !== null);
}

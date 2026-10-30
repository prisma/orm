import {
  type AnyExpression,
  BinaryExpr,
  type ColumnRef,
  type DeleteAst,
  ListExpression,
  OrExpr,
  type ParamRef,
  type ProjectionItem,
  type SelectAst,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import { combineWhereExprs } from '../where-utils';
import type { FilterData } from './filter-data';
import type { Executed, OutputsOf, Run } from './node';
import { executeStatement, rowsResult } from './run-statement';

export type Filtered = { filter: FilterData[] };

export function executeFiltered(
  ast: SelectAst | UpdateAst | DeleteAst,
  filter: OutputsOf<Filtered>['filter'],
  run: Run,
): Executed {
  if (filter === null) {
    return executeStatement(ast, run);
  }
  if (filter.some((conditions) => conditions.length === 0)) {
    return rowsResult([]);
  }
  const existing = ast.where === undefined ? [] : [ast.where];
  const where = combineWhereExprs([...existing, ...filter.map(anyOf)]);
  return executeStatement(ast.withWhere(where), run);
}

/** Any of the conditions: an `IN` list when each compares the same column with a parameter, else an `OR`. */
export function anyOf(conditions: readonly AnyExpression[]): AnyExpression {
  const [first, ...others] = conditions;
  if (first !== undefined && others.length === 0) {
    return first;
  }
  const column = sharedColumn(conditions);
  return column === undefined
    ? OrExpr.of(conditions)
    : BinaryExpr.in(
        column,
        ListExpression.of(
          conditions.flatMap((condition) => (isParamEq(condition) ? [condition.right] : [])),
        ),
      );
}

function isParamEq(
  condition: AnyExpression,
): condition is BinaryExpr & { readonly left: ColumnRef; readonly right: ParamRef } {
  return (
    condition.kind === 'binary' &&
    condition.op === 'eq' &&
    condition.left.kind === 'column-ref' &&
    condition.right.kind === 'param-ref'
  );
}

function sharedColumn(conditions: readonly AnyExpression[]): ColumnRef | undefined {
  const [first] = conditions;
  if (first === undefined || !isParamEq(first)) return undefined;
  const { table, column } = first.left;
  return conditions.every(
    (condition) =>
      isParamEq(condition) && condition.left.table === table && condition.left.column === column,
  )
    ? first.left
    : undefined;
}

export function withColumns(
  returned: readonly ProjectionItem[],
  columns: readonly ProjectionItem[],
): readonly ProjectionItem[] {
  const present = new Set(returned.map((item) => item.alias));
  return [...returned, ...columns.filter((column) => !present.has(column.alias))];
}

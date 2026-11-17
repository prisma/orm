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
import type { FilterData, KeyMatch } from './filter-data';
import type { JunctionFilterData } from './junction-filter-data';
import type { Executed, OutputsOf, Run } from './node';
import { type Requires, requirementUnmet } from './requires';
import { executeStatement, rowsResult } from './run-statement';
import type { StateEdge } from './state';

export type Filtered = { filter: FilterData[]; state: StateEdge[]; requires: Requires[] };

export type Linked = Filtered & { link: JunctionFilterData[] };

export const filteredSlots = { filter: 'list', state: 'list', requires: 'list' } as const;

export const linkedSlots = {
  filter: 'list',
  link: 'list',
  state: 'list',
  requires: 'list',
} as const;

type FilteredInputs = Pick<OutputsOf<Filtered>, 'filter' | 'requires'> &
  Partial<Pick<OutputsOf<Linked>, 'link'>>;

export function executeFiltered(
  ast: SelectAst | UpdateAst | DeleteAst,
  inputs: FilteredInputs,
  run: Run,
): Executed {
  const filter = inputs.filter ?? [];
  const link = inputs.link ?? [];
  if (requirementUnmet(inputs.requires)) {
    return rowsResult([]);
  }
  if (filter.length === 0 && link.length === 0) {
    return executeStatement(ast, run);
  }
  if ([...filter, ...link].some((rows) => rows.length === 0)) {
    return rowsResult([]);
  }
  return executeStatement(ast.withWhere(filteredWhere(ast, filter, link)), run);
}

export function filteredWhere(
  ast: SelectAst | UpdateAst | DeleteAst,
  filter: readonly (readonly KeyMatch[])[],
  link: readonly (readonly AnyExpression[])[],
): AnyExpression | undefined {
  return combineWhereExprs([
    ...(ast.where === undefined ? [] : [ast.where]),
    ...filter.map((matches) => anyOf(matches.map(({ condition }) => condition))),
    ...link.map(anyOf),
  ]);
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

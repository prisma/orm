import {
  type AnyExpression,
  type DeleteAst,
  OrExpr,
  type ProjectionItem,
  type SelectAst,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import { combineWhereExprs } from '../where-utils';
import type { FilterData } from './filter-data';
import type { Executed, OutputsOf, Run } from './node';
import { type Requires, requirementUnmet } from './requires';
import { executeStatement, rowsResult } from './run-statement';
import type { StateEdge } from './state';

export type Filtered = { filter: FilterData[]; state: StateEdge[]; requires: Requires[] };

export const filteredSlots = { filter: 'list', state: 'list', requires: 'list' } as const;

export function executeFiltered(
  ast: SelectAst | UpdateAst | DeleteAst,
  inputs: Pick<OutputsOf<Filtered>, 'filter' | 'requires'>,
  run: Run,
): Executed {
  const { filter } = inputs;
  if (requirementUnmet(inputs.requires)) {
    return rowsResult([]);
  }
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

function anyOf(conditions: readonly AnyExpression[]): AnyExpression {
  const [first, ...others] = conditions;
  return first !== undefined && others.length === 0 ? first : OrExpr.of(conditions);
}

export function withColumns(
  returned: readonly ProjectionItem[],
  columns: readonly ProjectionItem[],
): readonly ProjectionItem[] {
  const present = new Set(returned.map((item) => item.alias));
  return [...returned, ...columns.filter((column) => !present.has(column.alias))];
}

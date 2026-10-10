import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { type AnyExpression, OrExpr, type ProjectionItem } from '@internal/sql-relational-core/ast';
import { combineWhereExprs } from '../where-utils';
import type { StorageRow } from './edge';
import type { FilterData } from './filter-data';
import type { Executed, OutputsOf, Run, StatementAst } from './node';

export type Filtered = { filter: FilterData[] };

export function executeFiltered(
  ast: StatementAst,
  filter: OutputsOf<Filtered>['filter'],
  run: Run,
): Executed {
  if (filter === null) {
    return executeStatement(ast, run);
  }
  if (filter.some((conditions) => conditions.length === 0)) {
    return noRows();
  }
  const existing = ast.where === undefined ? [] : [ast.where];
  const where = combineWhereExprs([...existing, ...filter.map(anyOf)]);
  return executeStatement(ast.withWhere(where), run);
}

function executeStatement(ast: StatementAst, run: Run): Executed {
  return ast.kind === 'select' || ast.returning !== undefined ? run.query(ast) : run.execute(ast);
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

function noRows(): AsyncIterableResult<StorageRow> {
  const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {};
  return new AsyncIterableResult(generator());
}

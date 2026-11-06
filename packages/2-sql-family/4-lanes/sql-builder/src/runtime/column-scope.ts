import type {
  AnyExpression,
  AnyFromSource,
  AnyQueryAst,
  ColumnRef,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { structuredError } from '@internal/utils/structured-error';

interface Reads {
  readonly columns: readonly ColumnRef[];
  readonly subqueries: readonly SelectAst[];
}

const NOTHING: Reads = { columns: [], subqueries: [] };

/** The columns an expression reads itself, and the subqueries inside it, which read their own sources. */
function readsOf(expression: AnyExpression): Reads {
  return expression.fold<Reads>({
    empty: NOTHING,
    combine: (a, b) => ({
      columns: [...a.columns, ...b.columns],
      subqueries: [...a.subqueries, ...b.subqueries],
    }),
    columnRef: (columnRef) => ({ columns: [columnRef], subqueries: [] }),
    select: (subquery) => ({ columns: [], subqueries: [subquery] }),
  });
}

function aliasOf(source: AnyFromSource): string | undefined {
  return source.kind === 'table-source' ? (source.alias ?? source.name) : source.alias;
}

function assertReadsIn(expressions: readonly AnyExpression[], visible: ReadonlySet<string>): void {
  for (const expression of expressions) {
    const { columns, subqueries } = readsOf(expression);
    for (const column of columns) {
      if (!visible.has(column.table)) throw columnOutsideQuery(column, visible);
    }
    for (const subquery of subqueries) assertSelectReads(subquery, visible);
  }
}

function assertSelectReads(select: SelectAst, outer: ReadonlySet<string>): void {
  const sources = [select.from, ...(select.joins ?? []).map((join) => join.source)].filter(
    (source) => source !== undefined,
  );
  const visible = new Set([
    ...outer,
    ...sources.map(aliasOf).filter((alias) => alias !== undefined),
  ]);
  for (const source of sources) {
    if (source.kind === 'derived-table-source') assertSelectReads(source.query, visible);
    if (source.kind === 'function-source') assertReadsIn(source.args, visible);
  }
  assertReadsIn(
    [
      ...select.projection.map((item) => item.expr),
      ...(select.where === undefined ? [] : [select.where]),
      ...(select.orderBy ?? []).map((item) => item.expr),
      ...(select.groupBy ?? []),
      ...(select.having === undefined ? [] : [select.having]),
      ...(select.distinctOn ?? []),
      ...(select.joins ?? []).flatMap((join) =>
        join.on.kind === 'eq-col-join-on' ? [join.on.left, join.on.right] : [join.on],
      ),
    ],
    visible,
  );
}

/**
 * Refuses a statement that reads a column of an alias none of its sources, or of the queries around it, has. An expression built outside the query's callbacks, such as an index read from `table.as('other').indexes`, can name any alias.
 */
export function assertColumnsInScope(ast: AnyQueryAst): void {
  switch (ast.kind) {
    case 'select':
      assertSelectReads(ast, new Set());
      return;
    case 'update':
      assertReadsIn(
        [...Object.values(ast.set), ...(ast.where === undefined ? [] : [ast.where])],
        new Set([aliasOf(ast.table) ?? ast.table.name]),
      );
      return;
    case 'delete':
      assertReadsIn(
        ast.where === undefined ? [] : [ast.where],
        new Set([aliasOf(ast.table) ?? ast.table.name]),
      );
      return;
    default:
      return;
  }
}

function columnOutsideQuery(column: ColumnRef, visible: ReadonlySet<string>) {
  const sources = [...visible];
  return structuredError(
    'ORM.ARGUMENT_INVALID',
    `The query reads column "${column.column}" of "${column.table}", which is not one of its sources (${sources.map((source) => `"${source}"`).join(', ')}).`,
    {
      fix: 'Read the column, or the index, from a table the query selects from or joins, under the alias it has in the query.',
      meta: { alias: column.table, column: column.column, sources },
    },
  );
}

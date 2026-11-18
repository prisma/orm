import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  collectTableSources,
  DerivedTableSource,
  ListExpression,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  type TableSource,
} from '@internal/sql-relational-core/ast';
import { resolveRowIdentityColumns } from '../collection-contract';
import { ormError } from '../orm-errors';
import { storageOf } from './changed-by';

const capability = 'sql.subqueryReadsWrittenTable';
const keySetAlias = 'matching_keys';

/**
 * The `WHERE` of an `UPDATE` or a `DELETE` of `table` that matches the rows `where` matches.
 *
 * It is `where` itself, unless the contract lacks capability `sql.subqueryReadsWrittenTable` and a subquery of `where` reads `table`. Then it is `key IN (SELECT matching_keys.key FROM (SELECT key FROM table WHERE where) AS matching_keys)`, followed by each condition of `where` that does not read `table` in a subquery. See the README, "Writes whose filter reads the written table".
 */
export function writeWhere(
  contract: Contract<SqlStorage>,
  table: TableSource,
  where: AnyExpression | undefined,
): AnyExpression | undefined {
  if (where === undefined || contract.capabilities['sql']?.['subqueryReadsWrittenTable'] === true) {
    return where;
  }
  if (!readsInSubquery(where, table)) {
    return where;
  }
  const keys = rowIdentityOf(contract, table);
  const column = (key: string) => ColumnRef.of(table.alias ?? table.name, key);
  const matching = SelectAst.from(table)
    .withProjection(keys.map((key) => ProjectionItem.of(key, column(key))))
    .withWhere(where);
  const keySet = SelectAst.from(DerivedTableSource.as(keySetAlias, matching)).withProjection(
    keys.map((key) => ProjectionItem.of(key, ColumnRef.of(keySetAlias, key))),
  );
  const columns = keys.map(column);
  const [only, ...others] = columns;
  const inKeySet = BinaryExpr.in(
    only !== undefined && others.length === 0 ? only : ListExpression.of(columns),
    SubqueryExpr.of(keySet),
  );
  const repeated = conditionsOf(where).filter((condition) => !readsInSubquery(condition, table));
  return repeated.length === 0 ? inKeySet : AndExpr.of([inKeySet, ...repeated]);
}

function conditionsOf(where: AnyExpression): readonly AnyExpression[] {
  return where.kind === 'and' ? where.exprs.flatMap(conditionsOf) : [where];
}

function readsInSubquery(expr: AnyExpression, written: TableSource): boolean {
  const reads = (query: AnyQueryAst): boolean =>
    collectTableSources(query).some(
      (source) => source.name === written.name && source.namespaceId === written.namespaceId,
    );
  return expr.fold<boolean>({
    empty: false,
    combine: (a, b) => a || b,
    isAbsorbing: (found) => found,
    select: reads,
    mutation: reads,
  });
}

function rowIdentityOf(contract: Contract<SqlStorage>, table: TableSource): readonly string[] {
  const { namespaceId, tableName } = storageOf(table);
  const keys = resolveRowIdentityColumns(contract, namespaceId, tableName);
  if (keys.length > 0) {
    return keys;
  }
  throw ormError(
    'ORM.CAPABILITY_MISSING',
    `Cannot write table "${tableName}" by a filter with a subquery that reads "${tableName}": the contract lacks capability "${capability}", so the rows to write are selected by key first, and the table has no primary key and no unique constraint whose columns are all NOT NULL.`,
    { meta: { capability, table: tableName } },
  );
}

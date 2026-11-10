import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SelectAst, TableSource } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { resolveUniqueKeyColumnSets } from '../collection-contract';
import { Delete } from './delete';
import type { ColumnMapping } from './edge';
import { FilterData } from './filter-data';
import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import { Insert } from './insert';
import { InsertChunked } from './insert-chunked';
import type { Node } from './node';
import { Rows } from './rows';
import type { Rule } from './rules';
import { Update } from './update';

type Write = Insert | InsertChunked | Update | Delete;

export function readBackRule(contract: Contract<SqlStorage>): Rule {
  return (graph, node, inputs) => {
    if (!(node instanceof Find || node instanceof FindByKeys)) {
      return undefined;
    }
    const table = plainReadOf(node.ast);
    const [edge, ...others] = Object.values(inputs).flatMap((slot) => [slot ?? []].flat());
    if (
      table === undefined ||
      others.length > 0 ||
      !(edge instanceof FilterData || edge instanceof Rows) ||
      graph.latestWriteOf(table) !== edge.from
    ) {
      return undefined;
    }
    const write = graph.nodeAt(edge.from);
    if (!isWriteTo(write, table) || !readsByKey(contract, table, edge.columns)) {
      return undefined;
    }
    graph.replace(edge.from, write.withReturning(node.returns));
    return edge.from;
  };
}

function plainReadOf(ast: SelectAst): TableSource | undefined {
  const { from } = ast;
  const clauses = [
    ast.joins,
    ast.where,
    ast.orderBy,
    ast.distinct,
    ast.distinctOn,
    ast.groupBy,
    ast.having,
    ast.limit,
    ast.offset,
    ast.locking,
  ];
  return from?.kind === 'table-source' &&
    clauses.every((clause) => clause === undefined) &&
    ast.projection.every((item) => item.expr.kind === 'column-ref')
    ? from
    : undefined;
}

function isWriteTo(node: Node | undefined, table: TableSource): node is Write {
  return (
    (node instanceof Insert ||
      node instanceof InsertChunked ||
      node instanceof Update ||
      node instanceof Delete) &&
    node.statements.every(
      (ast) =>
        ast.kind !== 'select' &&
        ast.table.name === table.name &&
        ast.table.namespaceId === table.namespaceId &&
        !(ast.kind === 'insert' && ast.onConflict?.action.kind === 'do-nothing'),
    )
  );
}

function readsByKey(
  contract: Contract<SqlStorage>,
  table: TableSource,
  columns: readonly ColumnMapping[],
): boolean {
  const read = new Set(
    columns.flatMap(([source, target]) =>
      source.alias === target.alias &&
      source.expr.kind === 'column-ref' &&
      target.expr.kind === 'column-ref' &&
      source.expr.column === target.expr.column
        ? [target.expr.column]
        : [],
    ),
  );
  if (read.size !== columns.length) {
    return false;
  }
  const namespaceId = blindCast<
    string,
    'The ORM builds every table source with tableSourceForContract, which sets the namespace'
  >(table.namespaceId);
  return resolveUniqueKeyColumnSets(contract, namespaceId, table.name).some((key) =>
    key.every((column) => read.has(column)),
  );
}

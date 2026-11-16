import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { resolveRowIdentityColumns } from '../collection-contract';
import { readsNoRows, relatedReadsOf } from '../collection-dispatch';
import type { CollectionTables } from '../collection-tables';
import { selectIncludeStrategy } from '../include-strategy';
import { projectTableColumn } from '../mutation-statements';
import { relatedRowsSelect } from '../query-plan-select';
import type { IncludeExpr } from '../types';
import type { ColumnMapping, NodeId } from './edge';
import { FindRelated, RELATED_KEY_LIMITS } from './find-related';
import type { Graph } from './graph';
import { type Nest, NestJoin } from './nest-join';
import { Rows } from './rows';
import { WholeRows } from './whole-rows';

interface IncludeBuilder {
  readonly graph: Graph;
  readonly context: ExecutionContext;
}

/** Whether a statement that reads rows leaves its includes to steps of their own, read one query per relation. */
export function loadsIncludesPerRelation(
  contract: Contract<SqlStorage>,
  includes: readonly IncludeExpr[],
): boolean {
  return includes.length > 0 && selectIncludeStrategy(contract) === 'query';
}

export function addIncludeSteps(
  b: IncludeBuilder,
  parent: NodeId,
  parentTables: CollectionTables,
  includes: readonly IncludeExpr[],
): NodeId {
  const reads = includes.flatMap(relatedReadsOf).filter((read) => !readsNoRows(read));
  if (reads.length === 0) {
    return parent;
  }
  const { graph, context } = b;
  const { contract } = context;
  const { root } = parentTables;
  const identity = resolveRowIdentityColumns(
    contract,
    root.storage.namespaceId,
    root.storage.tableName,
  );
  const keyColumns = identity.map((column): ColumnMapping => {
    const item = projectTableColumn(contract, root, column);
    return [item, item];
  });
  const children = reads.map(({ key, include }) => {
    const { ast, parentKeys } = relatedRowsSelect(
      contract,
      context.aggregateDescriptors,
      parentTables,
      include,
    );
    const found = new FindRelated(ast, keyColumns, RELATED_KEY_LIMITS);
    const read = graph.add(found, {
      keys: new Rows(parent, keyColumns),
      state: graph.stateEdgesFor(found),
    });
    const nest: Nest = { name: key, parentKey: identity, childKey: parentKeys };
    const rows =
      include.scalar === undefined
        ? addIncludeSteps(b, read, include.nested.tables, include.nested.includes)
        : read;
    return { rows, nest };
  });
  return graph.add(new NestJoin(children.map(({ nest }) => nest)), {
    left: new WholeRows(parent),
    children: children.map(({ rows }) => new WholeRows(rows)),
  });
}

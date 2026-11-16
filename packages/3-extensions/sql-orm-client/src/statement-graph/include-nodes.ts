import { InternalError } from '@internal/utils/internal-error';
import { resolveRowIdentityColumns } from '../collection-contract';
import { type HiddenColumns, readsNoRows, relatedReadsOf } from '../collection-dispatch';
import { projectTableColumn } from '../mutation-statements';
import { ormError } from '../orm-errors';
import { relatedRowsSelect } from '../query-plan-select';
import type { CollectionState, IncludeExpr } from '../types';
import type { ColumnMapping, NodeId } from './edge';
import { FindRelated, RELATED_KEY_LIMITS } from './find-related';
import type { Graph } from './graph';
import type { Builder, Model } from './model-statements';
import { type Nest, NestJoin } from './nest-join';
import { Rows } from './rows';
import { WholeRows } from './whole-rows';

type ParentModel = Pick<Model, 'modelName' | 'tables'>;

/** Reads the rows of each include one query per relation, matched to the parent rows by the parent table's identity, which every level must have. */
export function addIncludeNodes(
  b: Builder,
  parent: NodeId,
  parentModel: ParentModel,
  includes: readonly IncludeExpr[],
): NodeId {
  const reads = includes.flatMap(relatedReadsOf).filter((read) => !readsNoRows(read));
  const [first] = reads;
  if (first === undefined) {
    return parent;
  }
  const { graph, context } = b;
  const { contract } = context;
  const parentTables = parentModel.tables;
  const { namespaceId, tableName } = parentTables.root.storage;
  const identity = resolveRowIdentityColumns(contract, namespaceId, tableName);
  if (identity.length === 0) {
    throw identityMissing(parentModel.modelName, tableName, first.include.relationName);
  }
  const { root } = parentTables;
  const keyColumns = identity.map((column): ColumnMapping => {
    const item = projectTableColumn(contract, root, column);
    return [item, item];
  });
  const children = reads.map(({ name, include }) => {
    const { ast, parentKey } = relatedRowsSelect(
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
    const nest: Nest = { name, identity, parentKey };
    const rows =
      include.scalar === undefined
        ? addIncludeNodes(
            b,
            read,
            { modelName: include.relatedModelName, tables: include.nested.tables },
            include.nested.includes,
          )
        : read;
    return { rows, nest };
  });
  return graph.add(new NestJoin(children.map(({ nest }) => nest)), {
    left: new WholeRows(parent),
    children: children.map(({ rows }) => new WholeRows(rows)),
  });
}

export function identityMissing(modelName: string, tableName: string, include: string) {
  return ormError(
    'ORM.ROW_IDENTITY_MISSING',
    `Cannot load include "${include}" of model "${modelName}": table "${tableName}" has no primary key, and no unique constraint whose columns are all NOT NULL, to match the included rows to their parent rows by.`,
    { meta: { model: modelName, table: tableName, include } },
  );
}

/** The columns each level of a read with includes read only to match rows to their parents, which the caller did not select. */
export function hiddenColumnsOf(graph: Graph, id: NodeId, state: CollectionState): HiddenColumns {
  const node = graph.nodeAt(id);
  if (!(node instanceof NestJoin)) {
    return { columns: unselectedColumnsReadFrom(graph, id, state), nested: new Map() };
  }
  const { left, children } = graph.inputsOf(id);
  const childEdges = [children ?? []].flat();
  const [parentEdge] = [left ?? []].flat();
  if (parentEdge === undefined) {
    throw new InternalError(`NestJoin ${id} has no parent rows`);
  }
  const readStates = new Map(
    state.includes.flatMap(relatedReadsOf).map(({ name, include }) => [name, include.nested]),
  );
  return {
    columns: unselectedColumnsReadFrom(graph, parentEdge.from, state),
    nested: new Map(
      node.nests.flatMap((nest, index) => {
        const edge = childEdges[index];
        const nestedState = readStates.get(nest.name);
        return edge === undefined || nestedState === undefined
          ? []
          : [[nest.name, hiddenColumnsOf(graph, edge.from, nestedState)] as const];
      }),
    ),
  };
}

function unselectedColumnsReadFrom(
  graph: Graph,
  id: NodeId,
  state: CollectionState,
): readonly string[] {
  const { selectedFields } = state;
  return graph
    .columnsReadFrom(id)
    .map((column) => column.alias)
    .filter((column) => selectedFields !== undefined && !selectedFields.includes(column));
}

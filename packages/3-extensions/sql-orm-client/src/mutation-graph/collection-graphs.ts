import {
  type AnyExpression,
  ColumnRef,
  checkLimitOffset,
  type ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import {
  resolvePrimaryKeyColumns,
  resolveRowIdentityColumns,
  supportsDefaultInInsert,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import {
  countMutationWhere,
  deleteAst,
  groupRowsByColumnSignature,
  type InsertConflictSkip,
  insertAst,
  projectTableColumn,
  projectTableColumns,
  returningProjection,
  updateAssignments,
  updateAst,
  upsertAst,
} from '../mutation-statements';
import { ormError } from '../orm-errors';
import { collectionSelectAst, collectionSelectWithIncludesAst } from '../query-plan-select';
import { variantReturning } from '../query-plan-source';
import type { ParsedRelationMutation } from '../relation-mutations';
import type { AliasedTable } from '../table-scope';
import { type CollectionState, emptyState } from '../types';
import { CrossJoin } from './cross-join';
import { Delete } from './delete';
import type { ColumnPair, NodeId } from './edge';
import { Find } from './find';
import { Graph } from './graph';
import { Insert } from './insert';
import { InsertChunked } from './insert-chunked';
import {
  addAfterWrite,
  addBeforeWrite,
  addCreateWithRelations,
  type BeforeWrite,
  type KeySource,
} from './nested-mutations';
import { UnionAll } from './union-all';
import { Update } from './update';

export function updateAllGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
): Graph {
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  if (Object.keys(set).length === 0) {
    graph.setResult(graph.add(new Find(selectRowsAst(collection, state))));
    return graph;
  }

  requireIdentityColumnsForIncludes(collection);
  const update = updateAst(context.contract, state.tables, set, whereOf(collection));
  const updated = graph.add(new Update(update));
  graph.setResult(addWithIncludes(graph, collection, updated));
  return graph;
}

export function deleteAllGraph(collection: DescribeCollectionRowsOptions): Graph {
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  const del = new Delete(deleteAst(context.contract, state.tables, whereOf(collection)));
  if (state.includes.length === 0) {
    graph.setResult(graph.add(del));
    return graph;
  }

  graph.setResult(graph.add(new Find(selectRowsAst(collection, state))));
  graph.add(del);
  return graph;
}

export function updateFirstGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  relationMutations: readonly ParsedRelationMutation[] = [],
): Graph {
  if (relationMutations.length > 0) {
    return updateFirstWithRelationsGraph(collection, set, relationMutations);
  }
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  const nothingToSet = Object.keys(set).length === 0;
  if (!nothingToSet) {
    requireIdentityColumns(collection);
    requireIdentityColumnsForIncludes(collection);
  }
  const find = addFindOfFirstRow(
    graph,
    collection,
    nothingToSet ? selectRowsAst : selectIdentityAst,
  );
  if (find === undefined) {
    return graph;
  }
  if (nothingToSet) {
    graph.setResult(find);
    return graph;
  }

  const update = updateAst(context.contract, state.tables, set, undefined);
  const updated = graph.add(new Update(update));
  graph.addFilterDataEdge(find, updated, sameRowColumns(collection));
  graph.setResult(addWithIncludes(graph, collection, updated));
  return graph;
}

function updateFirstWithRelationsGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  relationMutations: readonly ParsedRelationMutation[],
): Graph {
  const { context, modelName, namespaceId, state } = collection;
  const graph = new Graph(context.contract);
  requireIdentityColumns(collection);
  requireIdentityColumnsForIncludes(collection);
  const model = { namespaceId, modelName, tables: state.tables };
  const find = graph.add(new Find(selectIdentityAst(collection, { ...state, limit: 1 })));
  const t = { graph, context, gate: find };
  const before = addBeforeWrite(t, model, relationMutations);
  const values = withUpdateDefaults(collection, set, before);
  const parent =
    Object.keys(values).length === 0 && before.keys.length === 0
      ? find
      : addParentUpdate(graph, collection, find, values, before.keys);
  addAfterWrite(t, model, parent, relationMutations);
  graph.setResult(addWithIncludes(graph, collection, parent));
  return graph;
}

function addParentUpdate(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  find: NodeId,
  values: Readonly<Record<string, unknown>>,
  keys: readonly KeySource[],
): NodeId {
  const { context, state } = collection;
  const updated = graph.add(
    new Update(updateAst(context.contract, state.tables, values, undefined)),
  );
  graph.addFilterDataEdge(find, updated, sameRowColumns(collection));
  for (const { from, columns } of keys) {
    graph.addPayloadDataEdge(from, updated, columns);
  }
  return updated;
}

function withUpdateDefaults(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  before: BeforeWrite,
): Readonly<Record<string, unknown>> {
  const values: Record<string, unknown> = { ...set, ...before.nullColumns };
  const setNothingBefore = Object.keys(set).length === 0;
  const changesNow = Object.keys(values).length > 0 || before.keys.length > 0;
  if (setNothingBefore && changesNow) {
    const { namespaceId, tableName } = collection.state.tables.root.storage;
    for (const applied of collection.context.applyMutationDefaults({
      op: 'update',
      entry: tableName,
      namespace: namespaceId,
      values,
    })) {
      values[applied.field] = applied.value;
    }
  }
  return values;
}

export function deleteFirstGraph(collection: DescribeCollectionRowsOptions): Graph {
  const { context, state } = collection;
  const withIncludes = state.includes.length > 0;
  const graph = new Graph(context.contract);
  requireIdentityColumns(collection);
  const find = addFindOfFirstRow(
    graph,
    collection,
    withIncludes ? selectRowsAst : selectIdentityAst,
  );
  if (find === undefined) {
    return graph;
  }

  const del = deleteAst(context.contract, state.tables, undefined);
  const deleted = graph.add(new Delete(del));
  graph.addFilterDataEdge(find, deleted, sameRowColumns(collection));
  graph.setResult(withIncludes ? find : deleted);
  return graph;
}

export function createAllGraph(
  collection: DescribeCollectionRowsOptions,
  rows: readonly Record<string, unknown>[],
  conflict: InsertConflictSkip | undefined,
): Graph {
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  if (rows.length === 0) {
    return graph;
  }
  requireIdentityColumnsForIncludes(collection);
  const { contract } = context;
  const { root } = state.tables;
  const inserted = supportsDefaultInInsert(contract)
    ? graph.add(new Insert(insertAst(contract, root, rows, conflict)))
    : graph.add(
        new InsertChunked(
          groupRowsByColumnSignature(rows).map((group) =>
            insertAst(contract, root, group, conflict),
          ),
        ),
      );
  graph.setResult(addWithIncludes(graph, collection, inserted));
  return graph;
}

export function createGraph(
  collection: DescribeCollectionRowsOptions,
  data: Readonly<Record<string, unknown>>,
): Graph {
  const { context, modelName, namespaceId, state } = collection;
  const graph = new Graph(context.contract);
  requireIdentityColumnsForIncludes(collection);
  const created = addCreateWithRelations(
    { graph, context, gate: undefined },
    { namespaceId, modelName, tables: state.tables },
    data,
    [],
  );
  graph.setResult(addWithIncludes(graph, collection, created));
  return graph;
}

export interface VariantCreateRow {
  readonly base: Readonly<Record<string, unknown>>;
  readonly variant: Readonly<Record<string, unknown>>;
}

export function createAllVariantGraph(
  collection: DescribeCollectionRowsOptions,
  variantTable: AliasedTable,
  variantModelName: string,
  rows: readonly VariantCreateRow[],
): Graph {
  const { context, modelName, state } = collection;
  const { contract } = context;
  const { root } = state.tables;
  const graph = new Graph(contract);
  const keyColumns = resolvePrimaryKeyColumns(
    contract,
    root.storage.namespaceId,
    root.storage.tableName,
  );
  const keyPairs = keyColumns.map(
    (column): ColumnPair => [
      projectTableColumn(contract, root, column),
      projectTableColumn(contract, variantTable, column),
    ],
  );
  const baseColumns = returningProjection(contract, modelName, root, undefined);
  const variantColumns = variantReturning(contract, variantTable, variantModelName, keyColumns);

  const joins = rows.map((row) => {
    const baseInsert = insertAst(contract, root, [row.base], undefined).withReturning(baseColumns);
    const base = graph.add(new Insert(baseInsert));
    const variantInsert = insertAst(contract, variantTable, [row.variant], undefined).withReturning(
      variantColumns,
    );
    const variant = graph.add(new Insert(variantInsert));
    graph.addPayloadDataEdge(base, variant, keyPairs);
    const join = graph.add(new CrossJoin());
    graph.addRowsEdge(base, join, 'left', sameColumns(baseColumns));
    graph.addRowsEdge(variant, join, 'right', sameColumns(variantColumns));
    return join;
  });

  const [only, ...others] = joins;
  if (only !== undefined && others.length === 0) {
    graph.setResult(only);
  } else if (only !== undefined) {
    const joined = sameColumns([...baseColumns, ...variantColumns]);
    const union = graph.add(new UnionAll());
    for (const join of joins) {
      graph.addRowsEdge(join, union, 'rows', joined);
    }
    graph.setResult(union);
  }
  return graph;
}

function sameColumns(columns: readonly ProjectionItem[]): ColumnPair[] {
  return columns.map((column) => [column, column]);
}

export function upsertGraph(
  collection: DescribeCollectionRowsOptions,
  create: Readonly<Record<string, unknown>>,
  update: Readonly<Record<string, unknown>>,
  conflictColumns: readonly string[],
): Graph {
  const { context, state } = collection;
  const { root } = state.tables;
  const graph = new Graph(context.contract);
  requireIdentityColumnsForIncludes(collection);
  const updateSet =
    Object.keys(update).length > 0
      ? updateAssignments(context.contract, root, update)
      : Object.fromEntries(
          conflictColumns.slice(0, 1).map((column) => [column, ColumnRef.of('excluded', column)]),
        );
  const upsert = upsertAst(context.contract, root, create, conflictColumns, updateSet);
  const upserted = graph.add(new Insert(upsert));
  graph.setResult(addWithIncludes(graph, collection, upserted));
  return graph;
}

function addWithIncludes(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  written: NodeId,
): NodeId {
  const { state } = collection;
  if (state.includes.length === 0) {
    return written;
  }
  const select = selectRowsAst(collection, {
    ...emptyState(state.tables),
    selectedFields: state.selectedFields,
    includes: state.includes,
  });
  const find = graph.add(new Find(select));
  graph.addFilterDataEdge(written, find, sameRowColumns(collection));
  return find;
}

function requireIdentityColumnsForIncludes(collection: DescribeCollectionRowsOptions): void {
  const { modelName, state } = collection;
  const { tableName } = state.tables.root.storage;
  if (state.includes.length > 0 && identityColumnsOf(collection).length === 0) {
    throw ormError(
      'ORM.ROW_IDENTITY_MISSING',
      `Cannot load includes for the mutation result on model "${modelName}": table "${tableName}" has no primary key or unique constraint to key the include read-back on.`,
      { meta: { model: modelName, table: tableName } },
    );
  }
}

function addFindOfFirstRow(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  select: typeof selectIdentityAst,
): NodeId | undefined {
  const { state } = collection;
  checkLimitOffset('limit', state.limit);
  if (state.limit === 0) {
    return undefined;
  }
  return graph.add(new Find(select(collection, { ...state, limit: 1 })));
}

function requireIdentityColumns(collection: DescribeCollectionRowsOptions): void {
  const { modelName, state } = collection;
  const { tableName } = state.tables.root.storage;
  if (identityColumnsOf(collection).length === 0) {
    throw ormError(
      'ORM.ROW_IDENTITY_MISSING',
      `update()/delete() on model "${modelName}" requires the table to have a primary key or unique constraint`,
      { meta: { model: modelName, table: tableName } },
    );
  }
}

function selectIdentityAst(
  collection: DescribeCollectionRowsOptions,
  state: CollectionState,
): SelectAst {
  return collectionSelectAst(collection.context.contract, collection.modelName, {
    ...state,
    includes: [],
    selectedFields: identityColumnsOf(collection),
  });
}

function selectRowsAst(
  collection: DescribeCollectionRowsOptions,
  state: CollectionState,
): SelectAst {
  const { context, modelName } = collection;
  if (state.includes.length === 0) {
    return collectionSelectAst(context.contract, modelName, state);
  }
  return collectionSelectWithIncludesAst(
    context.contract,
    context.aggregateDescriptors,
    modelName,
    state,
  );
}

function identityColumnsOf(collection: DescribeCollectionRowsOptions): readonly string[] {
  const { namespaceId, tableName } = collection.state.tables.root.storage;
  return resolveRowIdentityColumns(collection.context.contract, namespaceId, tableName);
}

function sameRowColumns(collection: DescribeCollectionRowsOptions): ColumnPair[] {
  const { context, state } = collection;
  return sameColumns(
    projectTableColumns(context.contract, state.tables.root, identityColumnsOf(collection)),
  );
}

function whereOf(collection: DescribeCollectionRowsOptions): AnyExpression | undefined {
  const { context, state } = collection;
  return countMutationWhere(context.contract, state.tables, state.filters, state.variantValue);
}

import {
  type AnyExpression,
  checkLimitOffset,
  type ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { resolveRowIdentityColumns } from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import { mutationReturningColumns } from '../collection-mutation-dispatch';
import { ormError } from '../orm-errors';
import {
  countMutationWhere,
  deleteAst,
  projectTableColumns,
  returningProjection,
  updateAst,
} from '../query-plan-mutations';
import { collectionSelectAst, collectionSelectWithIncludesAst } from '../query-plan-select';
import { tableSourceForContract } from '../storage-resolution';
import type { CollectionState } from '../types';
import { combineWhereExprs } from '../where-utils';
import { Delete } from './delete';
import type { NodeId, Pending } from './edge';
import { type FilterData, filterData } from './filter-data';
import { Find } from './find';
import { Graph } from './graph';
import { Update } from './update';

export function updateAllGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  form: 'rows' | 'count',
): Graph {
  const { context, namespaceId, tableName } = collection;
  const graph = new Graph(form, collection);
  const update = updateAst(
    context.contract,
    namespaceId,
    tableName,
    set,
    whereOf(collection, form),
  );
  const returning = form === 'rows' ? resultColumns(collection) : [];
  graph.setResult(graph.add(new Update(update.withReturning(returning)), { filter: [] }));
  return graph;
}

export function deleteAllGraph(
  collection: DescribeCollectionRowsOptions,
  form: 'rows' | 'count',
): Graph {
  const { context, namespaceId, tableName, state } = collection;
  const graph = new Graph(form, collection);
  if (form === 'count' || state.includes.length === 0) {
    const del = deleteAst(context.contract, namespaceId, tableName, whereOf(collection, form));
    const returning = form === 'rows' ? resultColumns(collection) : [];
    graph.setResult(graph.add(new Delete(del.withReturning(returning)), { filter: [] }));
    return graph;
  }

  const find = graph.add(new Find(selectWithIncludesAst(collection, state)), { filter: [] });
  const del = deleteAst(context.contract, namespaceId, tableName, whereOf(collection, 'count'));
  graph.after(find, graph.add(new Delete(del), { filter: [] }));
  graph.setResult(find);
  return graph;
}

export function updateFirstGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
): Graph {
  const { context, namespaceId, tableName } = collection;
  const graph = new Graph('first row', collection);
  const find = addFindOfFirstRow(graph, collection);
  if (find === undefined) {
    return graph;
  }

  const update = updateAst(context.contract, namespaceId, tableName, set, undefined);
  const returning = resultColumns(collection);
  graph.setResult(
    graph.add(new Update(update.withReturning(returning)), {
      filter: [sameRow(find, collection)],
    }),
  );
  return graph;
}

export function deleteFirstGraph(collection: DescribeCollectionRowsOptions): Graph {
  const { context, namespaceId, tableName, state } = collection;
  const withIncludes = state.includes.length > 0;
  const graph = new Graph('first row', collection);
  const find = addFindOfFirstRow(
    graph,
    collection,
    withIncludes ? selectWithIncludesAst : selectIdentityAst,
  );
  if (find === undefined) {
    return graph;
  }

  const del = deleteAst(context.contract, namespaceId, tableName, undefined);
  const returning = withIncludes ? [] : resultColumns(collection);
  const deleted = graph.add(new Delete(del.withReturning(returning)), {
    filter: [sameRow(find, collection)],
  });
  graph.setResult(withIncludes ? find : deleted);
  return graph;
}

function addFindOfFirstRow(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  select: typeof selectIdentityAst = selectIdentityAst,
): NodeId | undefined {
  const { modelName, tableName, state } = collection;
  if (identityColumnsOf(collection).length === 0) {
    throw ormError(
      'ORM.ROW_IDENTITY_MISSING',
      `update()/delete() on model "${modelName}" requires the table to have a primary key or unique constraint`,
      { meta: { model: modelName, table: tableName } },
    );
  }
  checkLimitOffset('limit', state.limit);
  if (state.limit === 0) {
    return undefined;
  }
  return graph.add(new Find(select(collection, { ...state, limit: 1 })), { filter: [] });
}

function selectIdentityAst(
  collection: DescribeCollectionRowsOptions,
  state: CollectionState,
): SelectAst {
  const { context, namespaceId, modelName, tableName } = collection;
  return collectionSelectAst(context.contract, namespaceId, modelName, tableName, {
    ...state,
    includes: [],
    selectedFields: identityColumnsOf(collection),
  });
}

function selectWithIncludesAst(
  collection: DescribeCollectionRowsOptions,
  state: CollectionState,
): SelectAst {
  const { context, namespaceId, modelName, tableName } = collection;
  return collectionSelectWithIncludesAst(
    context.contract,
    context.aggregateDescriptors,
    namespaceId,
    modelName,
    tableName,
    state,
  );
}

function identityColumnsOf(collection: DescribeCollectionRowsOptions): readonly string[] {
  return resolveRowIdentityColumns(
    collection.context.contract,
    collection.namespaceId,
    collection.tableName,
  );
}

function sameRow(find: NodeId, collection: DescribeCollectionRowsOptions): Pending<FilterData> {
  const { context, namespaceId, tableName } = collection;
  const table = tableSourceForContract(context.contract, namespaceId, tableName);
  const columns = projectTableColumns(context.contract, table, identityColumnsOf(collection));
  return filterData(
    find,
    columns.map((column) => [column, column]),
  );
}

function resultColumns(collection: DescribeCollectionRowsOptions): readonly ProjectionItem[] {
  const { context, namespaceId, modelName, tableName, state } = collection;
  const columns = mutationReturningColumns(
    context.contract,
    namespaceId,
    modelName,
    tableName,
    state.selectedFields,
    state.includes,
  );
  return returningProjection(context.contract, namespaceId, modelName, tableName, columns);
}

function whereOf(
  collection: DescribeCollectionRowsOptions,
  form: 'rows' | 'count',
): AnyExpression | undefined {
  const { context, namespaceId, modelName, tableName, state } = collection;
  if (form === 'rows') {
    return combineWhereExprs(state.filters);
  }
  return countMutationWhere(
    context.contract,
    namespaceId,
    tableName,
    state.filters,
    state.variantName,
    modelName,
  );
}

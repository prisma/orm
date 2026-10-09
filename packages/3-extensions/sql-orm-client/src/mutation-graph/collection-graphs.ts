import {
  type AnyExpression,
  checkLimitOffset,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { resolveRowIdentityColumns } from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import { mutationReturningColumns } from '../collection-mutation-dispatch';
import { ormError } from '../orm-errors';
import { countMutationWhere, deleteAst, updateAst } from '../query-plan-mutations';
import { collectionSelectAst } from '../query-plan-select';
import type { CollectionState } from '../types';
import { combineWhereExprs } from '../where-utils';
import { after, filterData, type Input, type NodeId } from './edges';
import { Graph } from './graph';
import { Delete, Find, Update } from './nodes';

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
  graph.setResult(graph.add(new Update(update)));
  return graph;
}

export function deleteAllGraph(
  collection: DescribeCollectionRowsOptions,
  form: 'rows' | 'count',
): Graph {
  const { context, namespaceId, modelName, tableName, state } = collection;
  if (form === 'count' || state.includes.length === 0) {
    const graph = new Graph(form, collection);
    const del = deleteAst(context.contract, namespaceId, tableName, whereOf(collection, form));
    graph.setResult(graph.add(new Delete(del)));
    return graph;
  }

  const identityColumns = mutationReturningColumns(
    context.contract,
    namespaceId,
    modelName,
    tableName,
    state.selectedFields,
    state.includes,
  );
  const graph = new Graph(form, collection);
  const find = graph.add(new Find(selectColumnsAst(collection, state, identityColumns)));
  const del = deleteAst(context.contract, namespaceId, tableName, whereOf(collection, 'count'));
  graph.add(new Delete(del), after(find));
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
  graph.setResult(graph.add(new Update(update), sameRow(find, collection)));
  return graph;
}

export function deleteFirstGraph(collection: DescribeCollectionRowsOptions): Graph {
  const { context, namespaceId, tableName, state } = collection;
  const graph = new Graph('first row', collection);
  const find = addFindOfFirstRow(graph, collection);
  if (find === undefined) {
    return graph;
  }

  const del = deleteAst(context.contract, namespaceId, tableName, undefined);
  const deleted = graph.add(new Delete(del), sameRow(find, collection));
  graph.setResult(state.includes.length > 0 ? find : deleted);
  return graph;
}

function addFindOfFirstRow(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
): NodeId | undefined {
  const { modelName, tableName, state } = collection;
  const identityColumns = identityColumnsOf(collection);
  if (identityColumns.length === 0) {
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
  return graph.add(new Find(selectColumnsAst(collection, { ...state, limit: 1 }, identityColumns)));
}

function selectColumnsAst(
  collection: DescribeCollectionRowsOptions,
  state: CollectionState,
  columns: readonly string[] | undefined,
): SelectAst {
  const { context, namespaceId, modelName, tableName } = collection;
  return collectionSelectAst(context.contract, namespaceId, modelName, tableName, {
    ...state,
    includes: [],
    selectedFields: columns,
  });
}

function identityColumnsOf(collection: DescribeCollectionRowsOptions): readonly string[] {
  return resolveRowIdentityColumns(
    collection.context.contract,
    collection.namespaceId,
    collection.tableName,
  );
}

function sameRow(find: NodeId, collection: DescribeCollectionRowsOptions): Input {
  return filterData(
    find,
    identityColumnsOf(collection).map((column) => [column, column]),
  );
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

import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  ColumnRef,
  checkLimitOffset,
  type ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import {
  hasContractCapability,
  isAutoIncrementColumn,
  resolvePrimaryKeyColumns,
  resolveRowIdentityColumns,
  resolveUniqueKeyColumnSets,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import { ormError } from '../orm-errors';
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
} from '../query-plan-mutations';
import { collectionSelectAst, collectionSelectWithIncludesAst } from '../query-plan-select';
import { variantReturning } from '../query-plan-source';
import type { AliasedTable } from '../table-scope';
import { type CollectionState, emptyState } from '../types';
import { readBackIdentity, writtenKeys } from '../written-keys';
import { CrossJoin } from './cross-join';
import { Delete } from './delete';
import type { ColumnPair, NodeId, StorageRow } from './edge';
import { FilterData } from './filter-data';
import { Find } from './find';
import { FindByKeys, type MissingRow } from './find-by-keys';
import { Graph } from './graph';
import { Insert } from './insert';
import { InsertChunked } from './insert-chunked';
import { InsertReportingKeys } from './insert-reporting-keys';
import { PayloadData } from './payload-data';
import { Rows } from './rows';
import { UnionAll } from './union-all';
import { Update } from './update';
import { Values } from './values';

/** Whether the caller reads the written rows or only their count. */
export type WriteResult = 'rows' | 'count';

export function updateAllGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  result: WriteResult = 'rows',
): Graph {
  const { context, state } = collection;
  const graph = new Graph();
  if (Object.keys(set).length === 0) {
    graph.setResult(graph.add(new Find(selectRowsAst(collection, state)), { filter: [] }));
    return graph;
  }

  requireIdentityColumnsForIncludes(collection);
  const update = updateAst(context.contract, state.tables, set, whereOf(collection));
  if (readsBack(collection, result)) {
    const { namespaceId, tableName } = state.tables.root.storage;
    readBackIdentity(context.contract, namespaceId, tableName, collection.modelName, 'updateAll()');
    const found = graph.add(new Find(selectIdentityAst(collection, state)), { filter: [] });
    graph.add(new Update(update), { filter: [] });
    graph.setResult(
      addReadBack(graph, collection, found, keyOverrides(collection, set), undefined),
    );
    return graph;
  }
  const updated = graph.add(new Update(update), { filter: [] });
  graph.setResult(addWithIncludes(graph, collection, updated));
  return graph;
}

export function deleteAllGraph(
  collection: DescribeCollectionRowsOptions,
  result: WriteResult = 'rows',
): Graph {
  const { context, state } = collection;
  const graph = new Graph();
  const del = new Delete(deleteAst(context.contract, state.tables, whereOf(collection)));
  if (state.includes.length === 0 && !readsBack(collection, result)) {
    graph.setResult(graph.add(del, { filter: [] }));
    return graph;
  }

  graph.setResult(graph.add(new Find(selectRowsAst(collection, state)), { filter: [] }));
  graph.add(del, { filter: [] });
  return graph;
}

export function updateFirstGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
): Graph {
  const { context, state } = collection;
  const graph = new Graph();
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
  if (readsBack(collection, 'rows')) {
    graph.add(new Update(update), { filter: [sameRow(find, collection)] });
    graph.setResult(addReadBack(graph, collection, find, keyOverrides(collection, set), undefined));
    return graph;
  }
  const updated = graph.add(new Update(update), { filter: [sameRow(find, collection)] });
  graph.setResult(addWithIncludes(graph, collection, updated));
  return graph;
}

export function deleteFirstGraph(collection: DescribeCollectionRowsOptions): Graph {
  const { context, state } = collection;
  const readsRowsFirst = state.includes.length > 0 || readsBack(collection, 'rows');
  const graph = new Graph();
  requireIdentityColumns(collection);
  const find = addFindOfFirstRow(
    graph,
    collection,
    readsRowsFirst ? selectRowsAst : selectIdentityAst,
  );
  if (find === undefined) {
    return graph;
  }

  const del = deleteAst(context.contract, state.tables, undefined);
  const deleted = graph.add(new Delete(del), { filter: [sameRow(find, collection)] });
  graph.setResult(readsRowsFirst ? find : deleted);
  return graph;
}

export function createAllGraph(
  collection: DescribeCollectionRowsOptions,
  rows: readonly Record<string, unknown>[],
  conflict: InsertConflictSkip | undefined,
  result: WriteResult = 'rows',
): Graph {
  const { context, state } = collection;
  const graph = new Graph();
  if (rows.length === 0) {
    return graph;
  }
  requireIdentityColumnsForIncludes(collection);
  const { contract } = context;
  const { root } = state.tables;
  if (readsBack(collection, result)) {
    const method = rows.length === 1 ? 'create()' : 'createAll()';
    refuseSkipWithReadBack(collection, conflict, method);
    const { keys, generated } = writtenKeys({
      context,
      namespaceId: root.storage.namespaceId,
      tableName: root.storage.tableName,
      modelName: collection.modelName,
      rows,
      method,
    });
    const asts = supportsDefaultInInsert(contract)
      ? [insertAst(contract, root, rows, undefined)]
      : groupRowsByColumnSignature(rows).map((group) =>
          insertAst(contract, root, group, undefined),
        );
    const inserted = graph.add(
      new InsertReportingKeys(asts, keys, generated, collection.modelName),
      {},
    );
    graph.setResult(
      addReadBack(
        graph,
        collection,
        inserted,
        {},
        { operation: method, modelName: collection.modelName },
      ),
    );
    return graph;
  }
  const inserted = supportsDefaultInInsert(contract)
    ? graph.add(new Insert(insertAst(contract, root, rows, conflict)), { payload: [] })
    : graph.add(
        new InsertChunked(
          groupRowsByColumnSignature(rows).map((group) =>
            insertAst(contract, root, group, conflict),
          ),
        ),
        {},
      );
  graph.setResult(addWithIncludes(graph, collection, inserted));
  return graph;
}

function supportsDefaultInInsert(contract: Contract<SqlStorage>): boolean {
  return contract.capabilities['sql']?.['defaultInInsert'] === true;
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
  const graph = new Graph();
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
    const base = graph.add(new Insert(baseInsert), { payload: [] });
    const variantInsert = insertAst(contract, variantTable, [row.variant], undefined).withReturning(
      variantColumns,
    );
    const variant = graph.add(new Insert(variantInsert), {
      payload: [new PayloadData(base, keyPairs)],
    });
    return graph.add(new CrossJoin(), {
      left: new Rows(base, sameColumns(baseColumns)),
      right: new Rows(variant, sameColumns(variantColumns)),
    });
  });

  const [only, ...others] = joins;
  if (only !== undefined && others.length === 0) {
    graph.setResult(only);
  } else if (only !== undefined) {
    const joined = sameColumns([...baseColumns, ...variantColumns]);
    graph.setResult(
      graph.add(new UnionAll(), { rows: joins.map((join) => new Rows(join, joined)) }),
    );
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
  const { contract } = context;
  const { root } = state.tables;
  const graph = new Graph();
  requireIdentityColumnsForIncludes(collection);
  const targeted = hasContractCapability(contract, 'insertOnConflictTarget');
  if (!targeted) {
    requireOnlyCollidingKey(collection, create, conflictColumns);
  }
  const updateSet =
    Object.keys(update).length > 0
      ? updateAssignments(contract, root, update)
      : Object.fromEntries(
          conflictColumns.slice(0, 1).map((column) => [column, ColumnRef.of('excluded', column)]),
        );
  const upsert = upsertAst(contract, root, create, targeted ? conflictColumns : [], updateSet);
  if (readsBack(collection, 'rows')) {
    const conflictValues = upsertConflictValues(collection, create, update, conflictColumns);
    graph.add(new Insert(upsert), { payload: [] });
    const values = graph.add(new Values([conflictValues]), {});
    const keyColumns = projectTableColumns(contract, root, conflictColumns);
    graph.setResult(
      graph.add(
        new FindByKeys(
          readBackAst(collection),
          keyColumns,
          {},
          {
            operation: 'upsert()',
            modelName: collection.modelName,
          },
        ),
        { keys: new Rows(values, sameColumns(keyColumns)) },
      ),
    );
    return graph;
  }
  const upserted = graph.add(new Insert(upsert), { payload: [] });
  graph.setResult(addWithIncludes(graph, collection, upserted));
  return graph;
}

function addWithIncludes(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  written: NodeId,
): NodeId {
  if (collection.state.includes.length === 0) {
    return written;
  }
  return graph.add(new Find(readBackAst(collection)), { filter: [sameRow(written, collection)] });
}

function readBackAst(collection: DescribeCollectionRowsOptions): SelectAst {
  const { state } = collection;
  return selectRowsAst(collection, {
    ...emptyState(state.tables),
    selectedFields: state.selectedFields,
    includes: state.includes,
  });
}

/**
 * Without `RETURNING`, a write that returns rows runs as the write, then a select of the rows by key, chosen from the contract before anything runs.
 */
function readsBack(collection: DescribeCollectionRowsOptions, result: WriteResult): boolean {
  return result === 'rows' && !hasContractCapability(collection.context.contract, 'returning');
}

function addReadBack(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  keysFrom: NodeId,
  overrides: Readonly<StorageRow>,
  missing: MissingRow | undefined,
): NodeId {
  const keyColumns = identityProjection(collection);
  return graph.add(new FindByKeys(readBackAst(collection), keyColumns, overrides, missing), {
    keys: new Rows(keysFrom, sameColumns(keyColumns)),
  });
}

function identityProjection(collection: DescribeCollectionRowsOptions): readonly ProjectionItem[] {
  const { context, state } = collection;
  return projectTableColumns(context.contract, state.tables.root, identityColumnsOf(collection));
}

function keyOverrides(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
): StorageRow {
  return Object.fromEntries(
    identityColumnsOf(collection)
      .filter((column) => Object.hasOwn(set, column))
      .map((column) => [column, set[column]]),
  );
}

function refuseSkipWithReadBack(
  collection: DescribeCollectionRowsOptions,
  conflict: InsertConflictSkip | undefined,
  method: string,
): void {
  if (conflict === undefined) return;
  throw ormError(
    'ORM.CAPABILITY_MISSING',
    `${method} with onConflict "skip" on model "${collection.modelName}" requires contract capability "returning": without it the rows are read back by key, which finds a skipped row's existing match. Use createAndCount() to skip conflicting rows.`,
    { meta: { capability: 'returning', action: method } },
  );
}

/**
 * Without capability `insertOnConflictTarget`, the database's conflict clause fires on any unique key, so the upsert is allowed only when the named columns are the only key the create values can collide on: every other primary key or unique constraint contains an auto-increment column the create values leave out.
 */
function requireOnlyCollidingKey(
  collection: DescribeCollectionRowsOptions,
  create: Readonly<Record<string, unknown>>,
  conflictColumns: readonly string[],
): void {
  const { context, modelName, state } = collection;
  const { namespaceId, tableName } = state.tables.root.storage;
  const named = new Set(conflictColumns);
  const colliding = resolveUniqueKeyColumnSets(context.contract, namespaceId, tableName).find(
    (columns) =>
      !(columns.length === named.size && columns.every((column) => named.has(column))) &&
      !columns.some(
        (column) =>
          create[column] === undefined &&
          isAutoIncrementColumn(context.contract, namespaceId, tableName, column),
      ),
  );
  if (colliding === undefined) return;
  throw ormError(
    'ORM.CAPABILITY_MISSING',
    `upsert() on model "${modelName}" requires contract capability "insertOnConflictTarget": without it the conflict clause applies to every unique key, and the create values can also collide on (${colliding.join(', ')}), which would update a row other than the one conflictOn names.`,
    { meta: { capability: 'insertOnConflictTarget', action: 'upsert()', model: modelName } },
  );
}

/** The create's values for the conflict columns, by which an upsert without `RETURNING` reads its row back. */
function upsertConflictValues(
  collection: DescribeCollectionRowsOptions,
  create: Readonly<Record<string, unknown>>,
  update: Readonly<Record<string, unknown>>,
  conflictColumns: readonly string[],
): StorageRow {
  const { modelName } = collection;
  const refused = (problem: string) =>
    ormError(
      'ORM.CAPABILITY_MISSING',
      `upsert() on model "${modelName}" ${problem}; without capability "returning" the row is read back by the create's values for the conflict columns.`,
      { meta: { capability: 'returning', action: 'upsert()', model: modelName } },
    );
  const updated = conflictColumns.filter((column) => Object.hasOwn(update, column));
  if (updated.length > 0) {
    throw refused(`updates conflict column "${updated.join('", "')}"`);
  }
  const absent = conflictColumns.filter((column) => create[column] === undefined);
  if (absent.length > 0) {
    throw refused(`gives conflict column "${absent.join('", "')}" no create value`);
  }
  return Object.fromEntries(conflictColumns.map((column) => [column, create[column]]));
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
  return graph.add(new Find(select(collection, { ...state, limit: 1 })), { filter: [] });
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

function sameRow(find: NodeId, collection: DescribeCollectionRowsOptions): FilterData {
  const { context, state } = collection;
  const columns = projectTableColumns(
    context.contract,
    state.tables.root,
    identityColumnsOf(collection),
  );
  return new FilterData(
    find,
    columns.map((column) => [column, column]),
  );
}

function whereOf(collection: DescribeCollectionRowsOptions): AnyExpression | undefined {
  const { context, state } = collection;
  return countMutationWhere(context.contract, state.tables, state.filters, state.variantValue);
}

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
  supportsDefaultInInsert,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import {
  countMutationWhere,
  groupRowsByColumnSignature,
  type InsertConflictSkip,
  insertAst,
  projectTableColumn,
  projectTableColumns,
  returningProjection,
  updateAssignments,
  upsertAst,
} from '../mutation-statements';
import { ormError } from '../orm-errors';
import { variantReturning } from '../query-plan-source';
import type { ParsedMutationInput, ParsedRelationMutation } from '../relation-mutations';
import type { AliasedTable } from '../table-scope';
import { type CollectionState, emptyState } from '../types';
import { readBackIdentity, type WrittenRowOwner, writtenKeys } from '../written-keys';
import { CrossJoin } from './cross-join';
import type { ColumnPair, NodeId, StorageRow } from './edge';
import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import { Graph } from './graph';
import { Insert } from './insert';
import { InsertReportingKeys } from './insert-reporting-keys';
import { addDeleteRows, addInsertRows, addUpdateRows, selectAstOf } from './model-statements';
import {
  addAfterWrite,
  addBeforeWrite,
  addCreateWithRelations,
  type Translation,
} from './nested-mutations';
import {
  createRowOf,
  createRowsOf,
  type MtiCreateContext,
  mappedUpdateRow,
  modelOf,
  updateValuesOf,
  variantCreateRowsOf,
  withUpdateDefaults,
} from './storage-rows';
import { UnionAll } from './union-all';

/** What the call returns: the written rows, as `#rowsCall` does, or their count, as `#countCall` does. */
export type CallReturns = 'rows' | 'count';

export function updateAllGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  returns: CallReturns,
): Graph {
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  if (Object.keys(set).length === 0) {
    graph.setResult(graph.add(new Find(selectRowsAst(collection, state))));
    return graph;
  }

  requireIdentityColumnsForIncludes(collection);
  const update = { where: whereOf(collection), filters: [], payloads: [] };
  if (readsBack(collection, returns)) {
    const { namespaceId, tableName } = state.tables.root.storage;
    readBackIdentity(context.contract, namespaceId, tableName, collection.modelName, 'updateAll()');
    const found = graph.add(new Find(selectIdentityAst(collection, state)));
    addUpdateRows(graph, context.contract, state.tables, set, update);
    graph.setResult(
      addReadBack(graph, collection, found, keyOverrides(collection, set), state.includes),
    );
    return graph;
  }
  const updated = addUpdateRows(graph, context.contract, state.tables, set, update);
  graph.setResult(addWithIncludes(graph, collection, updated));
  return graph;
}

export function deleteAllGraph(
  collection: DescribeCollectionRowsOptions,
  returns: CallReturns,
): Graph {
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  const del = { where: whereOf(collection), filters: [] };
  if (state.includes.length === 0 && !readsBack(collection, returns)) {
    graph.setResult(addDeleteRows(graph, context.contract, state.tables, del));
    return graph;
  }

  graph.setResult(graph.add(new Find(selectRowsAst(collection, state))));
  addDeleteRows(graph, context.contract, state.tables, del);
  return graph;
}

export function updateFirstGraph(
  collection: DescribeCollectionRowsOptions,
  data: Readonly<Record<string, unknown>>,
  relationMutations: readonly ParsedRelationMutation[] = [],
): Graph {
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  const set = mappedUpdateRow(collection, data);
  const bare = Object.keys(set).length === 0 && relationMutations.length === 0;
  if (!bare) {
    requireIdentityColumns(collection);
    requireIdentityColumnsForIncludes(collection);
  }
  const find = addFindOfFirstRow(graph, collection, bare ? selectRowsAst : selectIdentityAst);
  if (find === undefined) {
    return graph;
  }
  if (bare) {
    graph.setResult(find);
    return graph;
  }

  const model = modelOf(collection);
  const t: Translation = {
    graph,
    context,
    parentRow: find,
    readsBack: readsBack(collection, 'rows'),
  };
  const before = addBeforeWrite(t, model, relationMutations);
  const values = withUpdateDefaults(collection, set, before);
  if (Object.keys(values).length === 0 && before.keys.length === 0) {
    addAfterWrite(t, model, find, relationMutations);
    graph.setResult(addWithIncludes(graph, collection, find));
    return graph;
  }

  const updated = addUpdateRows(graph, context.contract, state.tables, values, {
    where: undefined,
    filters: [{ from: find, columns: sameRowColumns(collection) }],
    payloads: before.keys,
  });
  if (!t.readsBack) {
    addAfterWrite(t, model, updated, relationMutations);
    graph.setResult(addWithIncludes(graph, collection, updated));
    return graph;
  }
  const changed = keyOverrides(collection, values);
  if (relationMutations.length === 0) {
    graph.setResult(addReadBack(graph, collection, find, changed, state.includes));
    return graph;
  }
  const updatedRow = addReadBack(graph, collection, find, changed, []);
  addAfterWrite(t, model, updatedRow, relationMutations);
  graph.setResult(addWithIncludes(graph, collection, updatedRow));
  return graph;
}

export function deleteFirstGraph(collection: DescribeCollectionRowsOptions): Graph {
  const { context, state } = collection;
  const readsRowsFirst = state.includes.length > 0 || readsBack(collection, 'rows');
  const graph = new Graph(context.contract);
  requireIdentityColumns(collection);
  const find = addFindOfFirstRow(
    graph,
    collection,
    readsRowsFirst ? selectRowsAst : selectIdentityAst,
  );
  if (find === undefined) {
    return graph;
  }

  const deleted = addDeleteRows(graph, context.contract, state.tables, {
    where: undefined,
    filters: [{ from: find, columns: sameRowColumns(collection) }],
  });
  graph.setResult(readsRowsFirst ? find : deleted);
  return graph;
}

export function createAllGraph(
  collection: DescribeCollectionRowsOptions,
  data: readonly Readonly<Record<string, unknown>>[],
  conflict: InsertConflictSkip | undefined,
  returns: CallReturns,
): Graph {
  const { context, state } = collection;
  const graph = new Graph(context.contract);
  if (data.length === 0) {
    return graph;
  }
  const rows = createRowsOf(collection, data);
  requireIdentityColumnsForIncludes(collection);
  const { contract } = context;
  const { root } = state.tables;
  if (readsBack(collection, returns)) {
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
    const owner = {
      operation: rows.length === 1 ? 'create' : 'createAll',
      modelName: collection.modelName,
    };
    const inserted = graph.add(new InsertReportingKeys(asts, keys, generated, owner));
    graph.setResult(
      addFindOfWrittenRows(graph, collection, inserted, identityProjection(collection), owner),
    );
    return graph;
  }
  const inserted = addInsertRows(graph, contract, root, rows, {
    conflict,
    keys: [],
    junction: undefined,
  });
  graph.setResult(addWithIncludes(graph, collection, inserted));
  return graph;
}

export function createGraph(
  collection: DescribeCollectionRowsOptions,
  parsed: ParsedMutationInput,
): Graph {
  const { context } = collection;
  const graph = new Graph(context.contract);
  requireIdentityColumnsForIncludes(collection);
  const created = addCreateWithRelations(
    { graph, context, parentRow: undefined, readsBack: readsBack(collection, 'rows') },
    modelOf(collection),
    parsed,
    [],
  );
  graph.setResult(addWithIncludes(graph, collection, created));
  return graph;
}

export function createAllVariantGraph(
  collection: DescribeCollectionRowsOptions,
  variantTable: AliasedTable,
  mti: MtiCreateContext,
  data: readonly Readonly<Record<string, unknown>>[],
): Graph {
  const { context, modelName, state } = collection;
  const variantModelName = mti.variant.modelName;
  const rows = variantCreateRowsOf(collection, mti, variantTable, data);
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
  createData: Readonly<Record<string, unknown>>,
  updateData: Readonly<Record<string, unknown>>,
  conflictColumns: readonly string[],
): Graph {
  const { context, state } = collection;
  const create = createRowOf(
    context,
    modelOf(collection),
    state.variantValue,
    createData,
    new Map(),
  );
  const update = updateValuesOf(collection, updateData);
  const { contract } = context;
  const { root } = state.tables;
  const graph = new Graph(context.contract);
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
    const upsertOwner = { operation: 'upsert', modelName: collection.modelName };
    const upserted = graph.add(
      new InsertReportingKeys([upsert], [conflictValues], undefined, upsertOwner),
    );
    graph.setResult(
      addFindOfWrittenRows(
        graph,
        collection,
        upserted,
        projectTableColumns(contract, root, conflictColumns),
        upsertOwner,
      ),
    );
    return graph;
  }
  const upserted = graph.add(new Insert(upsert));
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
  const find = graph.add(new Find(readBackAst(collection, collection.state.includes)));
  graph.addFilterDataEdge(written, find, sameRowColumns(collection));
  return find;
}

function readBackAst(
  collection: DescribeCollectionRowsOptions,
  includes: CollectionState['includes'],
): SelectAst {
  const { state } = collection;
  return selectRowsAst(collection, {
    ...emptyState(state.tables),
    selectedFields: state.selectedFields,
    includes,
  });
}

/**
 * Without `RETURNING`, a write that returns rows runs as the write, then a select of the rows by key, chosen from the contract before anything runs.
 */
function readsBack(collection: DescribeCollectionRowsOptions, returns: CallReturns): boolean {
  return returns === 'rows' && !hasContractCapability(collection.context.contract, 'returning');
}

/** A read of the rows a write changed, by the keys `keysFrom` found, with the new values of any key column the write set. */
function addReadBack(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  keysFrom: NodeId,
  changed: Readonly<StorageRow>,
  includes: CollectionState['includes'],
): NodeId {
  const find = graph.add(new Find(readBackAst(collection, includes)));
  graph.addFilterDataEdge(keysFrom, find, sameColumns(identityProjection(collection)), changed);
  return find;
}

function addFindOfWrittenRows(
  graph: Graph,
  collection: DescribeCollectionRowsOptions,
  inserted: NodeId,
  keyColumns: readonly ProjectionItem[],
  owner: WrittenRowOwner,
): NodeId {
  const pairs = sameColumns(keyColumns);
  const found = graph.add(
    new FindByKeys(readBackAst(collection, collection.state.includes), pairs, owner),
  );
  graph.addRowsEdge(inserted, found, 'keys', pairs);
  return found;
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
    { meta: { capability: 'insertOnConflictTarget', action: 'upsert()' } },
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
      { meta: { capability: 'returning', action: 'upsert()' } },
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
  return selectAstOf(collection.context, modelOf(collection), state, 'identity');
}

function selectRowsAst(
  collection: DescribeCollectionRowsOptions,
  state: CollectionState,
): SelectAst {
  return selectAstOf(collection.context, modelOf(collection), state, 'selection');
}

function identityColumnsOf(collection: DescribeCollectionRowsOptions): readonly string[] {
  const { namespaceId, tableName } = collection.state.tables.root.storage;
  return resolveRowIdentityColumns(collection.context.contract, namespaceId, tableName);
}

function sameRowColumns(collection: DescribeCollectionRowsOptions): ColumnPair[] {
  return sameColumns(identityProjection(collection));
}

function whereOf(collection: DescribeCollectionRowsOptions): AnyExpression | undefined {
  const { context, state } = collection;
  return countMutationWhere(context.contract, state.tables, state.filters, state.variantValue);
}

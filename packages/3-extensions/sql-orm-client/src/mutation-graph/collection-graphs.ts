import {
  type AnyExpression,
  ColumnRef,
  checkLimitOffset,
  type ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import {
  hasContractCapability,
  isAutoIncrementColumn,
  resolvePrimaryKeyColumns,
  resolveRowIdentityColumns,
  resolveUniqueKeyColumnSets,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import {
  countMutationWhere,
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
import type { CollectionState } from '../types';
import { rowIdentity } from '../written-keys';
import { CrossJoin } from './cross-join';
import type { ColumnMapping, NodeId } from './edge';
import { Graph } from './graph';
import { Insert } from './insert';
import {
  type Builder,
  deleteRows,
  findRows,
  insertRows,
  type Returns,
  readBack,
  type Shape,
  selectAstOf,
  updateRows,
} from './model-statements';
import {
  addAfterWrite,
  addBeforeWrite,
  addCreateWithRelations,
  type Translation,
} from './nested-mutations';
import { PayloadData } from './payload-data';
import { Rows } from './rows';
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

export function updateAllGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  returns: Returns,
): Graph {
  const { context, state } = collection;
  const b = builderOf(collection);
  if (Object.keys(set).length === 0) {
    b.graph.setResult(findRows(b, selectRowsAst(collection, state), noInputs));
    return b.graph;
  }
  if (returns === 'rows') {
    requireIdentityColumnsForIncludes(collection);
  }
  const where = whereOf(collection);
  const readsKeys = returns === 'rows' && identityColumnsOf(collection).length > 0;
  const filters = readsKeys
    ? [
        {
          from: findRows(
            b,
            SelectAst.from(state.tables.root.tableSource(context.contract))
              .withProjection(identityProjection(collection))
              .withWhere(where),
            noInputs,
          ),
          columns: sameRowColumns(collection),
        },
      ]
    : [];
  b.graph.setResult(
    updateRows(b, modelOf(collection), set, {
      where,
      filters,
      payloads: [],
      owner: { operation: 'updateAll', modelName: collection.modelName },
      returns,
      shape: shapeOf(collection),
      afterWrite: undefined,
    }),
  );
  return b.graph;
}

export function deleteAllGraph(collection: DescribeCollectionRowsOptions, returns: Returns): Graph {
  const { state } = collection;
  const b = builderOf(collection);
  const where = whereOf(collection);
  const find =
    returns === 'rows'
      ? findRows(b, selectRowsAst(collection, state).withWhere(where), noInputs)
      : undefined;
  const filters =
    find !== undefined && identityColumnsOf(collection).length > 0
      ? [{ from: find, columns: sameRowColumns(collection) }]
      : [];
  if (find !== undefined) {
    b.graph.setResult(find);
  }
  const deleted = deleteRows(b, state.tables, { where, filters });
  if (find === undefined) {
    b.graph.setResult(deleted);
  }
  return b.graph;
}

export function updateFirstGraph(
  collection: DescribeCollectionRowsOptions,
  data: Readonly<Record<string, unknown>>,
  relationMutations: readonly ParsedRelationMutation[] = [],
): Graph {
  const { state } = collection;
  const b = builderOf(collection);
  const set = mappedUpdateRow(collection, data);
  const bare = Object.keys(set).length === 0 && relationMutations.length === 0;
  if (!bare) {
    requireIdentityColumns(collection, 'update()');
    requireIdentityColumnsForIncludes(collection);
  }
  const find = addFindOfFirstRow(b, collection, bare ? selectRowsAst : selectIdentityAst);
  if (find === undefined) {
    return b.graph;
  }
  if (bare) {
    b.graph.setResult(find);
    return b.graph;
  }

  const model = modelOf(collection);
  const t: Translation = { ...b, parentRow: find };
  const before = addBeforeWrite(t, model, relationMutations);
  const values = withUpdateDefaults(collection, set, before);
  const owner = { operation: 'update', modelName: collection.modelName };
  if (Object.keys(values).length === 0 && before.keys.length === 0) {
    addAfterWrite(t, model, find, relationMutations);
    b.graph.setResult(
      state.includes.length === 0
        ? find
        : readBack(b, model, find, identityColumnsOf(collection), {
            shape: shapeOf(collection),
            by: 'filter',
            owner,
          }),
    );
    return b.graph;
  }

  b.graph.setResult(
    updateRows(b, model, values, {
      where: undefined,
      filters: [{ from: find, columns: sameRowColumns(collection) }],
      payloads: before.keys,
      owner,
      returns: 'rows',
      shape: shapeOf(collection),
      afterWrite: (updated) => addAfterWrite(t, model, updated, relationMutations),
    }),
  );
  return b.graph;
}

export function deleteFirstGraph(collection: DescribeCollectionRowsOptions): Graph {
  const { state } = collection;
  const b = builderOf(collection);
  requireIdentityColumns(collection, 'delete()');
  const find = addFindOfFirstRow(b, collection, selectRowsAst);
  if (find === undefined) {
    return b.graph;
  }
  deleteRows(b, state.tables, {
    where: undefined,
    filters: [{ from: find, columns: sameRowColumns(collection) }],
  });
  b.graph.setResult(find);
  return b.graph;
}

export function createAllGraph(
  collection: DescribeCollectionRowsOptions,
  data: readonly Readonly<Record<string, unknown>>[],
  conflict: InsertConflictSkip | undefined,
  returns: Returns,
): Graph {
  const b = builderOf(collection);
  if (data.length === 0) {
    return b.graph;
  }
  const rows = createRowsOf(collection, data);
  if (returns === 'rows') {
    requireIdentityColumnsForIncludes(collection);
  }
  b.graph.setResult(
    insertRows(b, modelOf(collection), rows, {
      conflict,
      keys: [],
      requires: [],
      owner: {
        operation: rows.length === 1 ? 'create' : 'createAll',
        modelName: collection.modelName,
      },
      returns,
      shape: shapeOf(collection),
      afterWrite: undefined,
    }),
  );
  return b.graph;
}

export function createGraph(
  collection: DescribeCollectionRowsOptions,
  parsed: ParsedMutationInput,
): Graph {
  const b = builderOf(collection);
  requireIdentityColumnsForIncludes(collection);
  b.graph.setResult(
    addCreateWithRelations({ ...b, parentRow: undefined }, modelOf(collection), parsed, {
      keysFromParent: [],
      returns: 'rows',
      shape: shapeOf(collection),
      variantValue: collection.state.variantValue,
    }),
  );
  return b.graph;
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
  const keyMappings = keyColumns.map(
    (column): ColumnMapping => [
      projectTableColumn(contract, root, column),
      projectTableColumn(contract, variantTable, column),
    ],
  );
  const baseColumns = returningProjection(contract, modelName, root, undefined);
  const variantColumns = variantReturning(contract, variantTable, variantModelName, keyColumns);

  const owner = { operation: 'createAll', modelName };
  const joins = rows.map((row) => {
    const baseInsert = new Insert(
      [insertAst(contract, root, [row.base], undefined).withReturning(baseColumns)],
      owner,
    );
    const base = graph.add(baseInsert, { state: graph.stateEdgesFor(baseInsert) });
    const variantInsert = new Insert(
      [insertAst(contract, variantTable, [row.variant], undefined).withReturning(variantColumns)],
      { operation: 'createAll', modelName: variantModelName },
    );
    const variant = graph.add(variantInsert, {
      payload: [new PayloadData(base, keyMappings)],
      state: graph.stateEdgesFor(variantInsert),
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

function sameColumns(columns: readonly ProjectionItem[]): ColumnMapping[] {
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
  const b = builderOf(collection);
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
  const owner = { operation: 'upsert', modelName: collection.modelName };
  const upsert = new Insert(
    [upsertAst(contract, root, create, targeted ? conflictColumns : [], updateSet)],
    owner,
  );
  const upserted = b.graph.add(upsert, { state: b.graph.stateEdgesFor(upsert) });
  b.graph.setResult(
    readBack(b, modelOf(collection), upserted, conflictColumns, {
      shape: shapeOf(collection),
      by: 'keys',
      owner,
    }),
  );
  return b.graph;
}

const noInputs = { filter: [], requires: [] };

function builderOf(collection: DescribeCollectionRowsOptions): Builder {
  return { graph: new Graph(collection.context.contract), context: collection.context };
}

function shapeOf(collection: DescribeCollectionRowsOptions): Shape {
  const { selectedFields, includes, variantValue } = collection.state;
  return { selectedFields, includes, variantValue };
}

function identityProjection(collection: DescribeCollectionRowsOptions): readonly ProjectionItem[] {
  const { context, state } = collection;
  return projectTableColumns(context.contract, state.tables.root, identityColumnsOf(collection));
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
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  select: typeof selectIdentityAst,
): NodeId | undefined {
  const { state } = collection;
  checkLimitOffset('limit', state.limit);
  if (state.limit === 0) {
    return undefined;
  }
  return findRows(b, select(collection, { ...state, limit: 1 }), noInputs);
}

function requireIdentityColumns(collection: DescribeCollectionRowsOptions, method: string): void {
  const { context, modelName, state } = collection;
  const { namespaceId, tableName } = state.tables.root.storage;
  rowIdentity(context.contract, namespaceId, tableName, modelName, method);
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

function sameRowColumns(collection: DescribeCollectionRowsOptions): ColumnMapping[] {
  return sameColumns(identityProjection(collection));
}

function whereOf(collection: DescribeCollectionRowsOptions): AnyExpression | undefined {
  const { context, state } = collection;
  return countMutationWhere(context.contract, state.tables, state.filters, state.variantValue);
}

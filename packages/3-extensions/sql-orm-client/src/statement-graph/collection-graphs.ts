import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  checkLimitOffset,
  type ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import {
  hasContractCapability,
  isAutoIncrementColumn,
  resolvePolymorphismInfo,
  resolvePrimaryKeyColumns,
  resolveRowIdentityColumns,
  resolveUniqueKeyColumnSets,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import { requireVariantTable } from '../collection-tables';
import { loadsIncludesPerRelation } from '../include-strategy';
import {
  countMutationWhere,
  type InsertConflictSkip,
  projectTableColumns,
  returningProjection,
  updateAssignments,
  upsertAst,
} from '../mutation-statements';
import { ormError } from '../orm-errors';
import { variantReturning } from '../query-plan-source';
import type { ParsedMutationInput, ParsedRelationMutation } from '../relation-mutations';
import type { CollectionState } from '../types';
import { paramRefForStorageColumn } from '../where-binding';
import { rowIdentity } from '../written-keys';
import { CrossJoin } from './cross-join';
import type { ColumnMapping, NodeId } from './edge';
import { Graph } from './graph';
import { addIncludeNodes, identityMissing } from './include-nodes';
import { Insert } from './insert';
import {
  type Builder,
  deleteRows,
  findRows,
  insertRows,
  type OnlyRows,
  type Returns,
  readBack,
  type Shape,
  type Sources,
  selectAstOf,
  updateRows,
} from './model-statements';
import {
  addAfterWrite,
  addBeforeWrite,
  addCreateWithRelations,
  addVariantCreates,
  type Translation,
  type VariantInserts,
} from './nested-mutations';
import { Rows } from './rows';
import {
  createRowOf,
  createRowsOf,
  type MtiCreateContext,
  mappedUpdateRow,
  modelOf,
  mtiCreateContextOf,
  updateValuesOf,
  withUpdateDefaults,
} from './storage-rows';
import { UnionAll } from './union-all';
import { pinsUniqueKey } from './unique-condition';

export function updateAllGraph(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  returns: Returns,
): Graph {
  const { context, state } = collection;
  const b = builderOf(collection);
  if (Object.keys(set).length === 0) {
    b.graph.setResult(
      withIncludeNodes(b, collection, findRows(b, selectRowsAst(collection, state), noInputs)),
    );
    return b.graph;
  }
  if (returns === 'rows') {
    requireIdentityColumnsForIncludes(collection);
  }
  const where = whereOf(collection);
  const readsKeys = returns === 'rows' && identityColumnsOf(collection).length > 0;
  const keys = readsKeys
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
  b.graph.setResult(addUpdateAll(b, collection, set, { filters: keys, links: [] }, returns));
  return b.graph;
}

export function addUpdateAll(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  { filters, links }: Sources,
  returns: Returns,
): NodeId {
  return updateRows(b, modelOf(collection), set, {
    where: whereOf(collection),
    filters,
    links,
    payloads: [],
    owner: { operation: 'updateAll', modelName: collection.modelName },
    returns,
    shape: shapeOf(collection),
    afterWrite: undefined,
  });
}

export function deleteAllGraph(collection: DescribeCollectionRowsOptions, returns: Returns): Graph {
  const { state } = collection;
  const b = builderOf(collection);
  if (returns === 'count') {
    b.graph.setResult(addDeleteAll(b, collection, { filters: [], links: [] }));
    return b.graph;
  }
  const find = findRows(
    b,
    selectRowsAst(collection, state).withWhere(whereOf(collection)),
    noInputs,
  );
  b.graph.setResult(withIncludeNodes(b, collection, find));
  addDeleteAll(b, collection, {
    filters:
      identityColumnsOf(collection).length > 0
        ? [{ from: find, columns: sameRowColumns(collection) }]
        : [],
    links: [],
  });
  return b.graph;
}

export function addDeleteAll(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  sources: Sources,
): NodeId {
  return deleteRows(b, collection.state.tables, { where: whereOf(collection), ...sources });
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
  const first = addFindOfFirstRow(b, collection, bare ? selectRowsAst : selectIdentityAst);
  if (first === undefined) {
    return b.graph;
  }
  const { find, where } = first;
  if (bare) {
    b.graph.setResult(withIncludeNodes(b, collection, find));
    return b.graph;
  }

  const model = modelOf(collection);
  const t: Translation = { ...b, parentRow: find };
  const before = addBeforeWrite(t, model, relationMutations);
  const writesBeforeUpdate = b.graph.writesAnyTable;
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
      where: writesBeforeUpdate ? undefined : where,
      filters: [{ from: find, columns: sameRowColumns(collection) }],
      links: [],
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
  const first = addFindOfFirstRow(b, collection, selectRowsAst);
  if (first === undefined) {
    return b.graph;
  }
  const { find, where } = first;
  b.graph.setResult(withIncludeNodes(b, collection, find));
  deleteRows(b, state.tables, {
    where,
    filters: [{ from: find, columns: sameRowColumns(collection) }],
    links: [],
  });
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
  const mti = mtiCreateContextOf(collection);
  if (mti !== undefined) {
    return createVariantGraph(collection, mti, [parsed], 'create');
  }
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

export function createVariantGraph(
  collection: DescribeCollectionRowsOptions,
  mti: MtiCreateContext,
  rows: readonly ParsedMutationInput[],
  operation: 'create' | 'createAll',
): Graph {
  const { context, modelName, state } = collection;
  const { contract } = context;
  const { root } = state.tables;
  const b = builderOf(collection);
  requireIdentityColumnsForIncludes(collection);
  const inserts: VariantInserts[] = [];
  addVariantCreates(
    { ...b, parentRow: undefined },
    { collection, mti, operation },
    rows,
    [],
    (inserted) => inserts.push(inserted),
  );
  const [first, ...others] = inserts;
  if (first === undefined) {
    return b.graph;
  }
  const keyColumns = resolvePrimaryKeyColumns(
    contract,
    root.storage.namespaceId,
    root.storage.tableName,
  );
  if (state.selectedFields !== undefined || state.includes.length > 0) {
    const key = sameColumns(projectTableColumns(contract, root, keyColumns));
    const written =
      others.length === 0
        ? first.base
        : b.graph.add(new UnionAll(), { rows: inserts.map(({ base }) => new Rows(base, key)) });
    b.graph.setResult(
      readBack(b, modelOf(collection), written, keyColumns, {
        shape: shapeOf(collection),
        by: 'keys',
        owner: { operation, modelName },
      }),
    );
    return b.graph;
  }
  const baseColumns = returningProjection(contract, modelName, root, undefined);
  const variantColumns = variantReturning(
    contract,
    requireVariantTable(state.tables, mti.variant.value),
    mti.variant.modelName,
    keyColumns,
  );
  const joins = inserts.map(({ base, variant }) =>
    b.graph.add(new CrossJoin(), {
      left: new Rows(base, sameColumns(baseColumns)),
      right: new Rows(variant, sameColumns(variantColumns)),
    }),
  );
  const [only] = joins;
  b.graph.setResult(
    only !== undefined && joins.length === 1
      ? only
      : b.graph.add(new UnionAll(), {
          rows: joins.map(
            (join) => new Rows(join, sameColumns([...baseColumns, ...variantColumns])),
          ),
        }),
  );
  return b.graph;
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
    readBack(
      b,
      modelOf(collection),
      upserted,
      conflictColumns,
      { shape: shapeOf(collection), by: 'keys', owner },
      rowsOfVariantOnly(collection, conflictColumns),
    ),
  );
  return b.graph;
}

function rowsOfVariantOnly(
  collection: DescribeCollectionRowsOptions,
  conflictColumns: readonly string[],
): OnlyRows | undefined {
  const { context, modelName, namespaceId, state } = collection;
  const { contract } = context;
  const { root } = state.tables;
  const polyInfo = resolvePolymorphismInfo(contract, namespaceId, modelName);
  const variant =
    state.variantValue === undefined ? undefined : polyInfo?.variants.get(state.variantValue);
  if (polyInfo === undefined || variant === undefined) {
    return undefined;
  }
  return {
    where: BinaryExpr.eq(
      root.column(polyInfo.discriminatorColumn),
      paramRefForStorageColumn(contract, root.storage, polyInfo.discriminatorColumn, variant.value),
    ),
    missing: ormError(
      'ORM.MUTATION_ROW_MISSING',
      `upsert() on variant "${variant.modelName}" of model "${modelName}" found the conflict values (${conflictColumns.join(', ')}) on a row of another variant, which it leaves unchanged`,
      {
        meta: {
          operation: 'upsert',
          model: modelName,
          variant: variant.modelName,
          phase: 'read-back',
        },
      },
    ),
  };
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

/** Refuses includes on a table with no identity, by which a write reads its rows back. */
export function requireIdentityColumnsForIncludes(collection: DescribeCollectionRowsOptions): void {
  const { modelName, state } = collection;
  const [include] = state.includes;
  if (include !== undefined && identityColumnsOf(collection).length === 0) {
    throw identityMissing(modelName, state.tables.root.storage.tableName, include.relationName);
  }
}

function addFindOfFirstRow(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  select: typeof selectIdentityAst,
): { readonly find: NodeId; readonly where: AnyExpression | undefined } | undefined {
  const { context, state } = collection;
  checkLimitOffset('limit', state.limit);
  if (state.limit === 0) {
    return undefined;
  }
  const where = whereOf(collection);
  if (
    state.offset === undefined &&
    state.cursor === undefined &&
    pinsUniqueKey(context.contract, state.tables.root, where)
  ) {
    const unordered = { ...state, limit: undefined, orderBy: undefined };
    return {
      find: findRows(b, select(collection, unordered).withWhere(where), noInputs),
      where,
    };
  }
  return {
    find: findRows(b, select(collection, { ...state, limit: 1 }), noInputs),
    where: undefined,
  };
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
  const statementState = loadsIncludesPerRelation(collection.context.contract, state.includes)
    ? { ...state, includes: [] }
    : state;
  return selectAstOf(collection.context, modelOf(collection), statementState, 'selection');
}

function withIncludeNodes(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  read: NodeId,
): NodeId {
  const { context, state } = collection;
  if (!loadsIncludesPerRelation(context.contract, state.includes)) {
    return read;
  }
  return addIncludeNodes(b, read, modelOf(collection), state.includes);
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

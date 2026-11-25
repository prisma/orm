import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  ColumnRef,
  checkLimitOffset,
  missingCapabilityRemedy,
  type ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { InternalError } from '@internal/utils/internal-error';
import {
  hasContractCapability,
  isAutoIncrementColumn,
  resolvePrimaryKeyColumns,
  resolveRowIdentityColumns,
  resolveUniqueKeyColumnSets,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import { loadsIncludesPerRelation } from '../include-strategy';
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
import { requireRowsThatCanConflict } from './conflict-keys';
import { CrossJoin } from './cross-join';
import { DeletedRows } from './deleted-rows';
import type { ColumnMapping, NodeId } from './edge';
import { FilterData } from './filter-data';
import { Find } from './find';
import { Graph } from './graph';
import { addIncludeNodes, identityMissing } from './include-nodes';
import { Insert } from './insert';
import {
  type Builder,
  deleteRows,
  findRows,
  insertRows,
  type KeyFilter,
  type KeyFilters,
  type Model,
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
  type ParentRow,
  rejectForeignKeyWithRelationMutation,
} from './nested-mutations';
import { PayloadData } from './payload-data';
import type { Requires } from './requires';
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
import { pinsUniqueKey } from './unique-condition';
import { WholeRows } from './whole-rows';

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
  b.graph.setResult(addUpdateAll(b, collection, set, { filters: keys, links: [] }, returns, where));
  return b.graph;
}

export function addUpdateAll(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  { filters, links }: KeyFilters,
  returns: Returns,
  where: AnyExpression | undefined,
): NodeId {
  return updateRows(b, modelOf(collection), set, {
    where,
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
    b.graph.setResult(addDeleteAll(b, collection, { filters: [], links: [] }, whereOf(collection)));
    return b.graph;
  }
  const where = whereOf(collection);
  const find = findRows(b, selectRowsAst(collection, state).withWhere(where), noInputs);
  const read = withIncludeNodes(b, collection, find);
  b.graph.setResult(read);
  if (identityColumnsOf(collection).length === 0) {
    addDeleteAll(b, collection, { filters: [], links: [] }, where);
    return b.graph;
  }
  const deleted = addDeleteAll(
    b,
    collection,
    { filters: [{ from: find, columns: sameRowColumns(collection) }], links: [] },
    where,
  );
  keepRowsTheDeleteRemoved(b, collection, { find, read, deleted });
  return b.graph;
}

export function addDeleteAll(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  keyFilters: KeyFilters,
  where: AnyExpression | undefined,
): NodeId {
  return deleteRows(b, collection.state.tables, { where, ...keyFilters });
}

export function addUpdateFirst(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  keyFilters: KeyFilters,
): void {
  const find = addFindOfFirstRelated(b, collection, 'update()', keyFilters);
  updateRows(b, modelOf(collection), set, {
    where: whereOf(collection),
    filters: [{ from: find, columns: sameRowColumns(collection) }, ...keyFilters.filters],
    links: keyFilters.links,
    payloads: [],
    owner: { operation: 'update', modelName: collection.modelName },
    returns: 'count',
    shape: shapeOf(collection),
    afterWrite: undefined,
  });
}

export function addDeleteFirst(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  keyFilters: KeyFilters,
  unlinkFound?: (found: NodeId) => void,
): void {
  const find = addFindOfFirstRelated(b, collection, 'delete()', keyFilters);
  unlinkFound?.(find);
  const byFoundKey = [{ from: find, columns: sameRowColumns(collection) }];
  deleteRows(
    b,
    collection.state.tables,
    unlinkFound === undefined
      ? {
          where: whereOf(collection),
          filters: [...byFoundKey, ...keyFilters.filters],
          links: keyFilters.links,
        }
      : { where: undefined, filters: byFoundKey, links: [] },
  );
}

function addFindOfFirstRelated(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  method: string,
  { filters, links }: KeyFilters,
): NodeId {
  requireIdentityColumns(collection, method);
  return findRows(b, selectIdentityAst(collection, { ...collection.state, limit: 1 }), {
    filter: filters.map(({ from, columns }) => new FilterData(from, columns)),
    requires: [],
    links,
  });
}

export function updateFirstGraph(
  collection: DescribeCollectionRowsOptions,
  data: Readonly<Record<string, unknown>>,
  relationMutations: readonly ParsedRelationMutation[] = [],
): Graph {
  rejectForeignKeyWithRelationMutation(data, relationMutations);
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
  const parent: ParentRow = { rowBeforeWrite: find, setValues: set };
  const before = addBeforeWrite(b, model, parent, relationMutations);
  const values = withUpdateDefaults(collection, set, before);
  const owner = { operation: 'update', modelName: collection.modelName };
  if (Object.keys(values).length === 0 && before.keys.length === 0) {
    addAfterWrite(b, model, { ...parent, node: find }, relationMutations);
    b.graph.setResult(
      state.includes.length === 0 && !before.unlinksAfterWrite
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
      where,
      filters: [{ from: find, columns: sameRowColumns(collection) }],
      links: [],
      payloads: before.keys,
      owner,
      returns: 'rows',
      shape: shapeOf(collection),
      afterWrite: (updated) =>
        addAfterWrite(b, model, { ...parent, node: updated }, relationMutations),
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
  const read = withIncludeNodes(b, collection, find);
  b.graph.setResult(read);
  const deleted = deleteRows(b, state.tables, {
    where,
    filters: [{ from: find, columns: sameRowColumns(collection) }],
    links: [],
  });
  keepRowsTheDeleteRemoved(b, collection, { find, read, deleted });
  return b.graph;
}

/** On a database with `RETURNING`, unless the delete took the place of the read, keeps only the rows read that the delete removed, with the values it returned. */
function keepRowsTheDeleteRemoved(
  b: Builder,
  collection: DescribeCollectionRowsOptions,
  {
    find,
    read,
    deleted,
  }: { readonly find: NodeId; readonly read: NodeId; readonly deleted: NodeId },
): void {
  const { graph } = b;
  if (
    graph.result === deleted ||
    !hasContractCapability(collection.context.contract, 'returning')
  ) {
    return;
  }
  const found = graph.nodeAt(find);
  if (!(found instanceof Find)) {
    throw new InternalError(`node ${find} read the rows a Delete removes, and is not a Find`);
  }
  const { alias } = collection.state.tables.root;
  const identity = sameRowColumns(collection);
  const columns = new Map<string, ColumnMapping>(
    identity.map((mapping) => [mapping[0].alias, mapping]),
  );
  for (const item of found.ast.projection) {
    if (item.expr.kind === 'column-ref' && item.expr.table === alias && !columns.has(item.alias)) {
      columns.set(item.alias, [item, item]);
    }
  }
  graph.setResult(
    graph.add(new DeletedRows(identity.map(([column]) => column.alias)), {
      found: new WholeRows(read),
      deleted: new Rows(deleted, [...columns.values()]),
    }),
  );
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
  if (conflict !== undefined) {
    const method = returns === 'rows' ? 'createAll()' : 'createAndCount()';
    const { modelName, state } = collection;
    requireRowsThatCanConflict(
      collection.context.contract,
      { action: method, modelName, meta: { method, model: modelName } },
      state.tables.root.storage,
      { onConflict: 'skip', columns: conflict.columns },
      rows,
      () => [],
    );
  }
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
    addCreateWithRelations(
      b,
      modelOf(collection),
      { rowBeforeWrite: undefined, setValues: {} },
      parsed,
      {
        keysFromParent: [],
        returns: 'rows',
        shape: shapeOf(collection),
        variantValue: collection.state.variantValue,
      },
    ),
  );
  return b.graph;
}

export interface NestedVariantCreate {
  readonly graph: Graph;
  readonly keys: readonly KeyFilter[];
  readonly requires: readonly Requires[];
  readonly added: (base: NodeId) => void;
}

export function createAllVariantGraph(
  collection: DescribeCollectionRowsOptions,
  variantTable: AliasedTable,
  mti: MtiCreateContext,
  data: readonly Readonly<Record<string, unknown>>[],
  nested?: NestedVariantCreate,
): Graph {
  const { context, modelName, state } = collection;
  const variantModelName = mti.variant.modelName;
  const rows = variantCreateRowsOf(collection, mti, variantTable, data);
  const { contract } = context;
  const { root } = state.tables;
  const graph = nested?.graph ?? new Graph(contract);
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
  const joins = rows.flatMap((row) => {
    const baseInsert = new Insert(
      [insertAst(contract, root, [row.base], undefined).withReturning(baseColumns)],
      owner,
    );
    const base = graph.add(baseInsert, {
      payload: (nested?.keys ?? []).map(({ from, columns }) => new PayloadData(from, columns)),
      state: graph.stateEdgesFor(baseInsert),
      requires: [...(nested?.requires ?? [])],
    });
    const variantInsert = new Insert(
      [insertAst(contract, variantTable, [row.variant], undefined).withReturning(variantColumns)],
      { operation: 'createAll', modelName: variantModelName },
    );
    const variant = graph.add(variantInsert, {
      payload: [new PayloadData(base, keyMappings)],
      state: graph.stateEdgesFor(variantInsert),
    });
    if (nested !== undefined) {
      nested.added(base);
      return [];
    }
    return [
      graph.add(new CrossJoin(), {
        left: new Rows(base, sameColumns(baseColumns)),
        right: new Rows(variant, sameColumns(variantColumns)),
      }),
    ];
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
    requireOnlyCollidingKey(context, modelOf(collection), create, conflictColumns, 'upsert()');
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
 * Without capability `insertOnConflictTarget`, the database's conflict clause fires on any unique key, so a write that updates on conflict is allowed only when the named columns are the only key the create values can collide on: every other primary key or unique constraint contains an auto-increment column the create values leave out.
 */
export function requireOnlyCollidingKey(
  context: ExecutionContext,
  { modelName, tables }: Model,
  create: Readonly<Record<string, unknown>>,
  conflictColumns: readonly string[],
  action: string,
): void {
  const { namespaceId, tableName } = tables.root.storage;
  const named = new Set(conflictColumns);
  const colliding = resolveUniqueKeyColumnSets(context.contract, namespaceId, tableName).find(
    (columns) =>
      !(columns.length === named.size && columns.every((column) => named.has(column))) &&
      !columns.some(
        (column) =>
          (!Object.hasOwn(create, column) || create[column] === undefined) &&
          isAutoIncrementColumn(context.contract, namespaceId, tableName, column),
      ),
  );
  if (colliding === undefined) return;
  throw ormError(
    'ORM.CAPABILITY_MISSING',
    `${action} on model "${modelName}" requires contract capability "insertOnConflictTarget": without it the conflict clause applies to every unique key, and the create values can also collide on (${colliding.join(', ')}), which would update a row other than the one conflictOn names. ${missingCapabilityRemedy()}`,
    { meta: { capability: 'insertOnConflictTarget', action } },
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
  return sameRowColumnsOf(collection.context.contract, collection.state.tables.root);
}

export function sameRowColumnsOf(
  contract: Contract<SqlStorage>,
  root: AliasedTable,
): ColumnMapping[] {
  const { namespaceId, tableName } = root.storage;
  return sameColumns(
    projectTableColumns(
      contract,
      root,
      resolveRowIdentityColumns(contract, namespaceId, tableName),
    ),
  );
}

export function whereOf(collection: DescribeCollectionRowsOptions): AnyExpression | undefined {
  const { context, state } = collection;
  return countMutationWhere(context.contract, state.tables, state.filters, state.variantValue);
}

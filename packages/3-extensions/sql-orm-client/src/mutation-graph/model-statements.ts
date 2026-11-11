import { type AnyExpression, SelectAst } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { resolveRowIdentityColumns, supportsDefaultInInsert } from '../collection-contract';
import type { CollectionTables } from '../collection-tables';
import {
  deleteAst,
  groupRowsByColumnSignature,
  type InsertConflictSkip,
  insertAst,
  projectTableColumns,
  returningProjection,
  updateAst,
} from '../mutation-statements';
import { collectionSelectAst, collectionSelectWithIncludesAst } from '../query-plan-select';
import type { AliasedTable } from '../table-scope';
import { type CollectionState, emptyState } from '../types';
import type { WrittenRowOwner } from '../written-keys';
import { Delete } from './delete';
import type { ColumnMapping, NodeId } from './edge';
import { FilterData } from './filter-data';
import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import type { Graph } from './graph';
import { Insert } from './insert';
import { InsertChunked } from './insert-chunked';
import type { JunctionWrite } from './junction-write';
import { PayloadData } from './payload-data';
import type { Requires } from './requires';
import { Rows } from './rows';
import { Update } from './update';

export interface Model {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly tables: CollectionTables;
}

export interface KeySource {
  readonly from: NodeId;
  readonly columns: readonly ColumnMapping[];
}

export interface Builder {
  readonly graph: Graph;
  readonly context: ExecutionContext;
}

export type Returns = 'rows' | 'count';

export interface Shape {
  readonly selectedFields: readonly string[] | undefined;
  readonly includes: CollectionState['includes'];
  readonly variantValue: string | undefined;
}

export const allColumns: Shape = {
  selectedFields: undefined,
  includes: [],
  variantValue: undefined,
};

export interface InsertWrite {
  readonly conflict: InsertConflictSkip | undefined;
  readonly keys: readonly KeySource[];
  readonly junction: JunctionWrite | undefined;
  readonly requires: readonly Requires[];
  readonly owner: WrittenRowOwner;
}

export function addInsert(
  { graph, context }: Builder,
  table: AliasedTable,
  rows: readonly Record<string, unknown>[],
  { conflict, keys, junction, requires, owner }: InsertWrite,
): NodeId {
  const { contract } = context;
  const inserted = supportsDefaultInInsert(contract)
    ? new Insert(insertAst(contract, table, rows, conflict), owner, junction)
    : new InsertChunked(
        groupRowsByColumnSignature(rows).map((group) =>
          insertAst(contract, table, group, conflict),
        ),
        owner,
        junction,
      );
  return graph.add(inserted, {
    payload: keys.map(({ from, columns }) => new PayloadData(from, columns)),
    state: graph.stateEdgesFor(inserted),
    requires: [...requires],
  });
}

export interface RowsRead {
  readonly returns: Returns;
  readonly shape: Shape;
  readonly afterWrite: ((written: NodeId) => void) | undefined;
}

export interface InsertRows extends RowsRead {
  readonly conflict: InsertConflictSkip | undefined;
  readonly keys: readonly KeySource[];
  readonly requires: readonly Requires[];
  readonly owner: WrittenRowOwner;
}

export function insertRows(
  b: Builder,
  model: Model,
  rows: readonly Record<string, unknown>[],
  { conflict, keys, requires, owner, returns, shape, afterWrite }: InsertRows,
): NodeId {
  const inserted = addInsert(b, model.tables.root, rows, {
    conflict,
    keys,
    junction: undefined,
    requires,
    owner,
  });
  afterWrite?.(inserted);
  return readBackRows(b, model, inserted, { returns, shape, by: 'keys', owner });
}

export interface UpdateRows extends RowsRead {
  readonly where: AnyExpression | undefined;
  readonly filters: readonly KeySource[];
  readonly payloads: readonly KeySource[];
  readonly owner: WrittenRowOwner;
}

export function updateRows(
  b: Builder,
  model: Model,
  values: Readonly<Record<string, unknown>>,
  { where, filters, payloads, owner, returns, shape, afterWrite }: UpdateRows,
): NodeId {
  const { graph, context } = b;
  const update = new Update(updateAst(context.contract, model.tables, values, where), owner);
  const updated = graph.add(update, {
    filter: filters.map(({ from, columns }) => new FilterData(from, columns)),
    payload: payloads.map(({ from, columns }) => new PayloadData(from, columns)),
    state: graph.stateEdgesFor(update),
  });
  afterWrite?.(updated);
  return readBackRows(b, model, updated, { returns, shape, by: 'filter', owner });
}

export interface DeleteRows {
  readonly where: AnyExpression | undefined;
  readonly filters: readonly KeySource[];
}

export function deleteRows(
  { graph, context }: Builder,
  tables: CollectionTables,
  { where, filters }: DeleteRows,
): NodeId {
  const deleted = new Delete(deleteAst(context.contract, tables, where));
  return graph.add(deleted, {
    filter: filters.map(({ from, columns }) => new FilterData(from, columns)),
    state: graph.stateEdgesFor(deleted),
  });
}

export function findRows(
  { graph }: Builder,
  ast: SelectAst,
  { filter, requires }: { readonly filter: FilterData[]; readonly requires: Requires[] },
): NodeId {
  const find = new Find(ast);
  return graph.add(find, { filter, state: graph.stateEdgesFor(find), requires });
}

export interface ReadBack {
  readonly shape: Shape;
  readonly by: 'keys' | 'filter';
  readonly owner: WrittenRowOwner;
}

export function readBack(
  b: Builder,
  model: Model,
  written: NodeId,
  keyColumns: readonly string[],
  { shape, by, owner }: ReadBack,
): NodeId {
  const { graph, context } = b;
  const { contract } = context;
  const { root } = model.tables;
  const { selectedFields, includes, variantValue } = shape;
  const { variants } = model.tables;
  const variantJoins = variantValue === undefined ? variants.size > 0 : variants.has(variantValue);
  const ast =
    includes.length === 0 && !variantJoins
      ? SelectAst.from(root.tableSource(contract)).withProjection(
          returningProjection(contract, model.modelName, root, selectedFields),
        )
      : selectAstOf(
          context,
          model,
          { ...emptyState(model.tables), selectedFields, includes, variantValue },
          'selection',
        );
  const mappings = projectTableColumns(contract, root, keyColumns).map(
    (column): ColumnMapping => [column, column],
  );
  if (by === 'filter') {
    return findRows(b, ast, { filter: [new FilterData(written, mappings)], requires: [] });
  }
  const found = new FindByKeys(ast, mappings, owner);
  return graph.add(found, { keys: new Rows(written, mappings), state: graph.stateEdgesFor(found) });
}

function readBackRows(
  b: Builder,
  model: Model,
  written: NodeId,
  { returns, shape, by, owner }: ReadBack & { readonly returns: Returns },
): NodeId {
  const { namespaceId, tableName } = model.tables.root.storage;
  const identity = resolveRowIdentityColumns(b.context.contract, namespaceId, tableName);
  return returns === 'count' || identity.length === 0
    ? written
    : readBack(b, model, written, identity, { shape, by, owner });
}

export type SelectedColumns = 'identity' | 'selection';

export function selectAstOf(
  context: ExecutionContext,
  model: Model,
  state: CollectionState,
  columns: SelectedColumns,
): SelectAst {
  const { contract } = context;
  const { modelName, tables } = model;
  if (columns === 'identity') {
    const { namespaceId, tableName } = tables.root.storage;
    return collectionSelectAst(contract, modelName, {
      ...state,
      includes: [],
      selectedFields: resolveRowIdentityColumns(contract, namespaceId, tableName),
    });
  }
  if (state.includes.length === 0) {
    return collectionSelectAst(contract, modelName, state);
  }
  return collectionSelectWithIncludesAst(contract, context.aggregateDescriptors, modelName, state);
}

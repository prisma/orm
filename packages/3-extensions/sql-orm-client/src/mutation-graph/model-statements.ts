import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression, SelectAst } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { resolveRowIdentityColumns, supportsDefaultInInsert } from '../collection-contract';
import type { CollectionTables } from '../collection-tables';
import {
  deleteAst,
  groupRowsByColumnSignature,
  type InsertConflictSkip,
  insertAst,
  updateAst,
} from '../mutation-statements';
import { collectionSelectAst, collectionSelectWithIncludesAst } from '../query-plan-select';
import type { AliasedTable } from '../table-scope';
import type { CollectionState } from '../types';
import { Delete } from './delete';
import type { ColumnMapping, NodeId } from './edge';
import { FilterData } from './filter-data';
import type { Graph } from './graph';
import { Insert } from './insert';
import { InsertChunked } from './insert-chunked';
import type { JunctionWrite } from './junction-write';
import { PayloadData } from './payload-data';
import type { Requires } from './requires';
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

export interface InsertRows {
  readonly conflict: InsertConflictSkip | undefined;
  readonly keys: readonly KeySource[];
  readonly junction: JunctionWrite | undefined;
  readonly requires: readonly Requires[];
}

export function addInsertRows(
  graph: Graph,
  contract: Contract<SqlStorage>,
  table: AliasedTable,
  rows: readonly Record<string, unknown>[],
  { conflict, keys, junction, requires }: InsertRows,
): NodeId {
  const inserted = supportsDefaultInInsert(contract)
    ? new Insert(insertAst(contract, table, rows, conflict), junction)
    : new InsertChunked(
        groupRowsByColumnSignature(rows).map((group) =>
          insertAst(contract, table, group, conflict),
        ),
        junction,
      );
  return graph.add(inserted, {
    payload: keys.map(({ from, columns }) => new PayloadData(from, columns)),
    state: graph.stateEdgesFor(inserted),
    requires: [...requires],
  });
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

export interface UpdateRows {
  readonly where: AnyExpression | undefined;
  readonly filters: readonly KeySource[];
  readonly payloads: readonly KeySource[];
}

export function addUpdateRows(
  graph: Graph,
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  values: Readonly<Record<string, unknown>>,
  { where, filters, payloads }: UpdateRows,
): NodeId {
  const updated = new Update(updateAst(contract, tables, values, where));
  return graph.add(updated, {
    filter: filters.map(({ from, columns }) => new FilterData(from, columns)),
    payload: payloads.map(({ from, columns }) => new PayloadData(from, columns)),
    state: graph.stateEdgesFor(updated),
  });
}

export interface DeleteRows {
  readonly where: AnyExpression | undefined;
  readonly filters: readonly KeySource[];
}

export function addDeleteRows(
  graph: Graph,
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  { where, filters }: DeleteRows,
): NodeId {
  const deleted = new Delete(deleteAst(contract, tables, where));
  return graph.add(deleted, {
    filter: filters.map(({ from, columns }) => new FilterData(from, columns)),
    state: graph.stateEdgesFor(deleted),
  });
}

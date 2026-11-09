import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { supportsDefaultInInsert } from '../collection-contract';
import type { CollectionTables } from '../collection-tables';
import {
  groupRowsByColumnSignature,
  type InsertConflictSkip,
  insertAst,
} from '../mutation-statements';
import type { AliasedTable } from '../table-scope';
import type { ColumnPair, NodeId } from './edge';
import type { Graph } from './graph';
import { Insert } from './insert';
import { InsertChunked } from './insert-chunked';
import type { JunctionWrite } from './junction-write';
import type { Requires } from './requires';

export interface Model {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly tables: CollectionTables;
}

export interface KeySource {
  readonly from: NodeId;
  readonly columns: readonly ColumnPair[];
}

export interface InsertRows {
  readonly conflict: InsertConflictSkip | undefined;
  readonly keys: readonly KeySource[];
  readonly junction: JunctionWrite | undefined;
}

export function addInsertRows(
  graph: Graph,
  contract: Contract<SqlStorage>,
  table: AliasedTable,
  rows: readonly Record<string, unknown>[],
  { conflict, keys, junction }: InsertRows,
): NodeId<{ requires: Requires[] }> {
  const inserted = supportsDefaultInInsert(contract)
    ? graph.add(new Insert(insertAst(contract, table, rows, conflict), junction))
    : graph.add(
        new InsertChunked(
          groupRowsByColumnSignature(rows).map((group) =>
            insertAst(contract, table, group, conflict),
          ),
          junction,
        ),
      );
  for (const { from, columns } of keys) {
    graph.addPayloadDataEdge(from, inserted, columns);
  }
  return inserted;
}

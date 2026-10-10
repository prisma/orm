import type { Brand } from '@internal/contract/types';
import type { ProjectionItem } from '@internal/sql-relational-core/ast';

export type NodeId = number & Brand<'MutationGraphNodeId'>;

export type StorageRow = Record<string, unknown>;

export type ColumnPair = readonly [source: ProjectionItem, target: ProjectionItem];

export abstract class Edge<Output> {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly columns: readonly ColumnPair[];

  constructor(from: NodeId, to: NodeId, columns: readonly ColumnPair[]) {
    this.from = from;
    this.to = to;
    this.columns = Object.freeze([...columns]);
  }

  abstract output(sourceRow: StorageRow): Output;
}

export type Pending<E> = (to: NodeId) => E;

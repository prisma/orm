import type { Brand } from '@internal/contract/types';
import type { ProjectionItem } from '@internal/sql-relational-core/ast';
import type { Slots } from './node';

declare const inputsOfNode: unique symbol;

export type NodeId<Inputs extends Slots = Slots> = number &
  Brand<'MutationGraphNodeId'> & { readonly [inputsOfNode]?: Inputs };

export type StorageRow = Record<string, unknown>;

export type ColumnPair = readonly [source: ProjectionItem, target: ProjectionItem];

export abstract class Edge<Output> {
  readonly from: NodeId;

  constructor(from: NodeId) {
    this.from = from;
  }

  abstract output(sourceRow: StorageRow): Output;
}

export abstract class DataEdge<Output> extends Edge<Output> {
  readonly columns: readonly ColumnPair[];

  constructor(from: NodeId, columns: readonly ColumnPair[]) {
    super(from);
    this.columns = Object.freeze([...columns]);
  }
}

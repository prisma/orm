import type { ColumnPair, NodeId } from './edge';

export class After {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly columns: readonly ColumnPair[] = [];

  constructor(from: NodeId, to: NodeId) {
    this.from = from;
    this.to = to;
    Object.freeze(this);
  }
}

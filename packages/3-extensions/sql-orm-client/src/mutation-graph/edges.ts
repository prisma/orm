import type { Node } from './nodes';

export type ColumnPair = readonly [sourceColumn: string, targetColumn: string];

export abstract class Edge {
  readonly from: Node;
  readonly to: Node;

  constructor(from: Node, to: Node) {
    this.from = from;
    this.to = to;
  }

  abstract replaceNode(old: Node, next: Node): Edge;
}

export class After extends Edge {
  constructor(from: Node, to: Node) {
    super(from, to);
    Object.freeze(this);
  }

  override replaceNode(old: Node, next: Node): After {
    return new After(this.from === old ? next : this.from, this.to === old ? next : this.to);
  }
}

export class FilterData extends Edge {
  readonly columns: readonly ColumnPair[];

  constructor(from: Node, to: Node, columns: readonly ColumnPair[]) {
    super(from, to);
    this.columns = Object.freeze([...columns]);
    Object.freeze(this);
  }

  override replaceNode(old: Node, next: Node): FilterData {
    return new FilterData(
      this.from === old ? next : this.from,
      this.to === old ? next : this.to,
      this.columns,
    );
  }
}

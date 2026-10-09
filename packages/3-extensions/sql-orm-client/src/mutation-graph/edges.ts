export type NodeId = number;

export type ColumnPair = readonly [sourceColumn: string, targetColumn: string];

export class After {
  readonly from: NodeId;
  readonly to: NodeId;

  constructor(from: NodeId, to: NodeId) {
    this.from = from;
    this.to = to;
    Object.freeze(this);
  }
}

export class FilterData {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly columns: readonly ColumnPair[];

  constructor(from: NodeId, to: NodeId, columns: readonly ColumnPair[]) {
    this.from = from;
    this.to = to;
    this.columns = Object.freeze([...columns]);
    Object.freeze(this);
  }
}

export type Edge = After | FilterData;

export type Input = (to: NodeId) => Edge;

export function after(from: NodeId): Input {
  return (to) => new After(from, to);
}

export function filterData(from: NodeId, columns: readonly ColumnPair[]): Input {
  return (to) => new FilterData(from, to, columns);
}

import type { TableStorageCoordinate } from '../table-scope';
import { Edge, type NodeId } from './edge';
import { type Executed, Node, type OutputsOf, type Run } from './node';
import { rowsResult } from './run-statement';

export class StateEdge extends Edge<undefined> {
  readonly table: TableStorageCoordinate;

  constructor(from: NodeId, table: TableStorageCoordinate) {
    super(from);
    this.table = table;
    Object.freeze(this);
  }

  override output(): undefined {
    return undefined;
  }

  override withFrom(from: NodeId): StateEdge {
    return new StateEdge(from, this.table);
  }
}

export type StateSlot = { state: StateEdge[] };

type Inputs = { write: StateEdge[] };

export class State extends Node<Inputs> {
  readonly slots = { write: 'list' } as const;
  readonly table: TableStorageCoordinate;

  constructor(table: TableStorageCoordinate) {
    super();
    this.table = table;
    Object.freeze(this);
  }

  override execute(_inputs: OutputsOf<Inputs>, _run: Run): Executed {
    return rowsResult([]);
  }
}

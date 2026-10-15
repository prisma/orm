import type { TableCoordinate } from '@internal/sql-relational-core/ast';
import { Edge, type NodeId } from './edge';
import { type Executed, Node, type OutputsOf, type Run } from './node';
import { rowsResult } from './run-statement';

export class StateEdge extends Edge<undefined> {
  readonly table: TableCoordinate;

  constructor(from: NodeId, table: TableCoordinate) {
    super(from);
    this.table = table;
    Object.freeze(this);
  }

  override output(): undefined {
    return undefined;
  }
}

export type StateSlot = { state: StateEdge[] };

type Inputs = { write: StateEdge[] };

export class State extends Node<Inputs> {
  readonly slots = { write: 'list' } as const;
  readonly table: TableCoordinate;

  constructor(table: TableCoordinate) {
    super();
    this.table = table;
    Object.freeze(this);
  }

  override execute(_inputs: OutputsOf<Inputs>, _run: Run): Executed {
    return rowsResult([]);
  }
}

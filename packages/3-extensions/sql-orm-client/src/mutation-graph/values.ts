import type { StorageRow } from './edge';
import { type Executed, Node, type OutputsOf, type Run } from './node';
import { rowsResult } from './run-statement';

type NoInputs = Record<never, never>;

/** Rows the client already knows, for a node that reads rows by key. */
export class Values extends Node<NoInputs> {
  readonly rows: readonly StorageRow[];

  constructor(rows: readonly StorageRow[]) {
    super();
    this.rows = Object.freeze([...rows]);
    Object.freeze(this);
  }

  override execute(_inputs: OutputsOf<NoInputs>, _run: Run): Executed {
    return rowsResult(this.rows);
  }
}

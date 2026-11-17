import { type Executed, Node, type OutputsOf, type Run } from './node';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';

type Inputs = { rows: Rows[] };

export class UnionAll extends Node<Inputs> {
  readonly slots = { rows: 'list' } as const;

  constructor() {
    super();
    Object.freeze(this);
  }

  override execute(inputs: OutputsOf<Inputs>, _run: Run): Executed {
    return rowsResult((inputs.rows ?? []).flat());
  }
}

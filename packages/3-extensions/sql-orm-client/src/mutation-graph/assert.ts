import { type Executed, Node, type OutputsOf, type Run } from './node';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';

type Inputs = { rows: Rows };

export class Assert extends Node<Inputs> {
  readonly slots = { rows: 'one' } as const;
  readonly error: Error;

  constructor(error: Error) {
    super();
    this.error = error;
    Object.freeze(this);
  }

  override execute(inputs: OutputsOf<Inputs>, _run: Run): Executed {
    if (inputs.rows.length === 0) {
      throw this.error;
    }
    return rowsResult([]);
  }
}

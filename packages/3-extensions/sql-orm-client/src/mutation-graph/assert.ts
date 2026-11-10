import { type Executed, Node, type OutputsOf, type Run } from './node';
import { type Requires, requirementUnmet } from './requires';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';

type Inputs = { rows: Rows; requires: Requires[] };

export class Assert extends Node<Inputs> {
  readonly slots = { rows: 'one', requires: 'list' } as const;
  readonly error: Error;

  constructor(error: Error) {
    super();
    this.error = error;
    Object.freeze(this);
  }

  override execute(inputs: OutputsOf<Inputs>, _run: Run): Executed {
    if (requirementUnmet(inputs.requires)) {
      return rowsResult([]);
    }
    if (inputs.rows.length === 0) {
      throw this.error;
    }
    return rowsResult([]);
  }
}

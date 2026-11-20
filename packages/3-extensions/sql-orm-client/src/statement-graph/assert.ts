import { type Executed, Node, type OutputsOf, type Run } from './node';
import { type Requires, requirementUnmet } from './requires';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';

type Inputs = { rows: Rows; requires: Requires[] };

export class Assert extends Node<Inputs> {
  readonly slots = { rows: 'one', requires: 'list' } as const;
  readonly error: Error;
  readonly expected: Readonly<Record<string, unknown>>;

  constructor(error: Error, expected: Readonly<Record<string, unknown>> = {}) {
    super();
    this.error = error;
    this.expected = Object.freeze({ ...expected });
    Object.freeze(this);
  }

  override execute(inputs: OutputsOf<Inputs>, _run: Run): Executed {
    if (requirementUnmet(inputs.requires)) {
      return rowsResult([]);
    }
    const { expected } = this;
    if (
      inputs.rows.length === 0 ||
      inputs.rows.some((row) =>
        Object.entries(expected).some(([column, value]) => row[column] !== value),
      )
    ) {
      throw this.error;
    }
    return rowsResult([]);
  }
}

import { type Executed, Node, type OutputsOf, type Run } from './node';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';

type Inputs = { left: Rows; right: Rows };

export class CrossJoin extends Node<Inputs> {
  readonly slots = { left: 'one', right: 'one' } as const;

  constructor() {
    super();
    Object.freeze(this);
  }

  override execute(inputs: OutputsOf<Inputs>, _run: Run): Executed {
    const [left] = inputs.left;
    const [right] = inputs.right;
    if (left === undefined || right === undefined) {
      return rowsResult([]);
    }
    return rowsResult([{ ...left, ...right }]);
  }
}

import { invariant } from '@internal/utils/assertions';
import type { StorageRow } from './edge';
import { type Executed, Node, type OutputsOf, type Run } from './node';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';
import { stitchKey } from './stitch-key';
import type { WholeRows } from './whole-rows';

type Inputs = { found: WholeRows; deleted: Rows };

/** The found rows that the delete removed, matched by `identity`, with the values the delete returned. */
export class DeletedRows extends Node<Inputs> {
  readonly slots = { found: 'one', deleted: 'one' } as const;
  override readonly passesRowsOf = 'found';
  readonly identity: readonly string[];

  constructor(identity: readonly string[]) {
    super();
    this.identity = Object.freeze([...identity]);
    Object.freeze(this);
  }

  override execute(inputs: OutputsOf<Inputs>, _run: Run): Executed {
    const deleted = new Map(inputs.deleted.map((row) => [this.#keyOf(row), row]));
    return rowsResult(
      inputs.found.flatMap((row) => {
        const missing = this.identity.filter((column) => !Object.hasOwn(row, column));
        invariant(
          missing.length === 0,
          `a row read before a Delete lacks identity column(s) ${missing.join(', ')}; the Delete's key edge from the Find makes the Find return them`,
        );
        const removed = deleted.get(this.#keyOf(row));
        return removed === undefined ? [] : [{ ...row, ...removed }];
      }),
    );
  }

  #keyOf(row: StorageRow): string {
    return stitchKey(this.identity.map((column) => row[column]));
  }
}

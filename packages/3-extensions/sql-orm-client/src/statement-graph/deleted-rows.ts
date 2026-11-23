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
        const removed = deleted.get(this.#keyOf(row));
        return removed === undefined ? [] : [{ ...row, ...reported(removed) }];
      }),
    );
  }

  #keyOf(row: StorageRow): string {
    return stitchKey(this.identity.map((column) => row[column]));
  }
}

/** A delete without `RETURNING` reports only the keys it was given; the other columns are absent, not null. */
function reported(row: StorageRow): StorageRow {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

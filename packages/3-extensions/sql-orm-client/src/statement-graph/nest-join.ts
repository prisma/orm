import type { StorageRow } from './edge';
import { type Executed, Node, type OutputsOf, type Run } from './node';
import { rowsResult } from './run-statement';
import { stitchKey } from './stitch-key';
import type { WholeRows } from './whole-rows';

/** One include a `NestJoin` attaches: the name its rows go under, and the columns that hold the parent's identity in the parent rows and in the child rows. */
export interface Nest {
  readonly name: string;
  readonly parentKey: readonly string[];
  readonly childKey: readonly string[];
}

type Inputs = { left: WholeRows; children: WholeRows[] };

/** Attaches to each parent row, under each include's name, the child rows whose parent key equals the parent's identity. The rows of `children` are positionally those of `nests`. */
export class NestJoin extends Node<Inputs> {
  readonly slots = { left: 'one', children: 'list' } as const;
  readonly nests: readonly Nest[];

  constructor(nests: readonly Nest[]) {
    super();
    this.nests = Object.freeze([...nests]);
    Object.freeze(this);
  }

  override execute(inputs: OutputsOf<Inputs>, _run: Run): Executed {
    const children = inputs.children ?? [];
    const groups = this.nests.map((nest, index) =>
      groupByKey(children[index] ?? [], nest.childKey),
    );
    return rowsResult(
      inputs.left.map((parent) => {
        const joined: StorageRow = { ...parent };
        this.nests.forEach((nest, index) => {
          joined[nest.name] = groups[index]?.get(keyOf(parent, nest.parentKey)) ?? [];
        });
        return joined;
      }),
    );
  }
}

function groupByKey(
  rows: readonly StorageRow[],
  columns: readonly string[],
): ReadonlyMap<string, readonly StorageRow[]> {
  const groups = new Map<string, StorageRow[]>();
  for (const row of rows) {
    const key = keyOf(row, columns);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [row]);
    } else {
      group.push(row);
    }
  }
  return groups;
}

function keyOf(row: StorageRow, columns: readonly string[]): string {
  return stitchKey(columns.map((column) => row[column]));
}

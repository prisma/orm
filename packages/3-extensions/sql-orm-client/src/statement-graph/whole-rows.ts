import { Edge, type NodeId, type StorageRow } from './edge';

/** Passes each source row whole, unlike `Rows`, which copies only the columns it lists: the lists a `NestJoin` attached travel with their row. */
export class WholeRows extends Edge<StorageRow> {
  constructor(from: NodeId) {
    super(from);
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): StorageRow {
    return sourceRow;
  }
}

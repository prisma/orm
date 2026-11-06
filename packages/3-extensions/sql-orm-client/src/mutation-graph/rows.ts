import { type ColumnPair, Edge, type NodeId, type StorageRow } from './edge';

export class Rows extends Edge<StorageRow> {
  constructor(from: NodeId, columns: readonly ColumnPair[]) {
    super(from, columns);
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): StorageRow {
    return Object.fromEntries(
      this.columns.map(([source]) => [source.alias, sourceRow[source.alias]]),
    );
  }
}

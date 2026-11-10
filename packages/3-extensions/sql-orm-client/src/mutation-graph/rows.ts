import { type ColumnMapping, DataEdge, type NodeId, type StorageRow } from './edge';

export class Rows extends DataEdge<StorageRow> {
  constructor(from: NodeId, columns: readonly ColumnMapping[]) {
    super(from, columns);
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): StorageRow {
    return Object.fromEntries(
      this.columns.map(([source]) => [source.alias, sourceRow[source.alias]]),
    );
  }

  override withFrom(from: NodeId): Rows {
    return new Rows(from, this.columns);
  }
}

import { ParamRef } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { type ColumnPair, Edge, type NodeId, type StorageRow } from './edge';

export type Payload = Readonly<Record<string, ParamRef>>;

export class PayloadData extends Edge<Payload> {
  constructor(from: NodeId, columns: readonly ColumnPair[]) {
    super(from, columns);
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): Payload {
    return Object.fromEntries(
      this.columns.map(([source, target]) => [
        target.alias,
        ParamRef.of(sourceRow[source.alias], {
          name: target.alias,
          ...ifDefined('codec', target.codec),
        }),
      ]),
    );
  }
}

import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { type ColumnPair, Edge, type NodeId, type StorageRow } from './edge';

/** The condition that matches the row whose source columns hold the values in `sourceRow`. */
export function keyCondition(columns: readonly ColumnPair[], sourceRow: StorageRow): AnyExpression {
  const conditions = columns.map(([source, target]) =>
    BinaryExpr.eq(
      target.expr,
      ParamRef.of(sourceRow[source.alias], {
        name: target.alias,
        ...ifDefined('codec', target.codec),
      }),
    ),
  );
  const [first, ...others] = conditions;
  return first !== undefined && others.length === 0 ? first : AndExpr.of(conditions);
}

/** Matches each source row's row in the reading statement. `changed` holds new values, by source column, that a write between the two gave every row. */
export class FilterData extends Edge<AnyExpression> {
  readonly changed: Readonly<StorageRow>;

  constructor(from: NodeId, columns: readonly ColumnPair[], changed: Readonly<StorageRow> = {}) {
    super(from, columns);
    this.changed = changed;
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): AnyExpression {
    return keyCondition(this.columns, { ...sourceRow, ...this.changed });
  }
}

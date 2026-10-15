import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { type ColumnPair, DataEdge, type NodeId, type StorageRow } from './edge';

export class FilterData extends DataEdge<AnyExpression> {
  constructor(from: NodeId, columns: readonly ColumnPair[]) {
    super(from, columns);
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): AnyExpression {
    const conditions = this.columns.map(([source, target]) =>
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
}

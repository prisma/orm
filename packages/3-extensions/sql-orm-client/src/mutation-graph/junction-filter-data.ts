import {
  type AnyExpression,
  BinaryExpr,
  ListExpression,
  SelectAst,
  SubqueryExpr,
  type TableSource,
} from '@internal/sql-relational-core/ast';
import { type ColumnMapping, DataEdge, type NodeId, type StorageRow } from './edge';
import { keyCondition } from './filter-data';

export class JunctionFilterData extends DataEdge<AnyExpression> {
  readonly junction: TableSource;
  readonly targets: readonly ColumnMapping[];

  constructor(
    from: NodeId,
    columns: readonly ColumnMapping[],
    junction: TableSource,
    targets: readonly ColumnMapping[],
  ) {
    super(from, columns);
    this.junction = junction;
    this.targets = Object.freeze([...targets]);
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): AnyExpression {
    const keys = this.targets.map(([, target]) => target.expr);
    const [only, ...others] = keys;
    return BinaryExpr.in(
      only !== undefined && others.length === 0 ? only : ListExpression.of(keys),
      SubqueryExpr.of(
        SelectAst.from(this.junction)
          .withProjection(this.targets.map(([child]) => child))
          .withWhere(keyCondition(this.columns, sourceRow)),
      ),
    );
  }
}

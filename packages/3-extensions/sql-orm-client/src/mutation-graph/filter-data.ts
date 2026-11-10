import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { type ColumnMapping, DataEdge, type NodeId, type StorageRow } from './edge';

/** The condition that matches the row whose source columns hold the values in `sourceRow`. */
export function keyCondition(
  columns: readonly ColumnMapping[],
  sourceRow: StorageRow,
): AnyExpression {
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

export interface KeyMatch {
  readonly condition: AnyExpression;
  readonly key: Readonly<StorageRow>;
}

/** Matches each source row's row in the reading statement: the condition that selects it, and its key by target column. */
export class FilterData extends DataEdge<KeyMatch> {
  constructor(from: NodeId, columns: readonly ColumnMapping[]) {
    super(from, columns);
    Object.freeze(this);
  }

  override output(sourceRow: StorageRow): KeyMatch {
    return {
      condition: keyCondition(this.columns, sourceRow),
      key: Object.fromEntries(
        this.columns.map(([source, target]) => [target.alias, sourceRow[source.alias]]),
      ),
    };
  }

  override withFrom(from: NodeId): FilterData {
    return new FilterData(from, this.columns);
  }
}

import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ParamRef,
  type ProjectionItem,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';

export type NodeId = number;

export type StorageRow = Record<string, unknown>;

export type ColumnPair = readonly [source: ProjectionItem, target: ProjectionItem];

export abstract class Edge<Output> {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly columns: readonly ColumnPair[];

  constructor(from: NodeId, to: NodeId, columns: readonly ColumnPair[]) {
    this.from = from;
    this.to = to;
    this.columns = Object.freeze([...columns]);
  }

  abstract output(sourceRow: StorageRow): Output;
}

export class FilterData extends Edge<AnyExpression> {
  constructor(from: NodeId, to: NodeId, columns: readonly ColumnPair[]) {
    super(from, to, columns);
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

export class After {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly columns: readonly ColumnPair[] = [];

  constructor(from: NodeId, to: NodeId) {
    this.from = from;
    this.to = to;
    Object.freeze(this);
  }
}

export type Pending<E> = (to: NodeId) => E;

export function filterData(from: NodeId, columns: readonly ColumnPair[]): Pending<FilterData> {
  return (to) => new FilterData(from, to, columns);
}

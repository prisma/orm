/**
 * Renders the SQL a resolved aggregate row computes with, so a probe measures
 * the expression that row actually runs.
 *
 * The lossless variants and the integer `avg` reach the database through their
 * lowering — `sumBigInt` computes with `sum`, `avg` casts its result — so a call
 * named after the operation would measure something no query builds.
 */

import type { CodecRef } from '@internal/framework-components/codec';
import type { SqlAggregateLowering } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { AggregateExpr, CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';

export interface AggregateSqlRequest {
  readonly operation: string;
  /** The lowering the registry resolved for this row, absent where the row declares none. */
  readonly lower: SqlAggregateLowering | undefined;
  readonly inputCodec: CodecRef | undefined;
  readonly table: string;
  /** The column being aggregated, absent for a call over rows. */
  readonly column: string | undefined;
}

/** Renders the node kinds an aggregate lowering builds. A lowering reaching for anything else is one these suites cannot measure, and says so rather than probing something other than the row. */
function render(expr: AnyExpression): string {
  if (expr instanceof AggregateExpr) {
    return `${expr.fn}(${expr.expr === undefined ? '*' : render(expr.expr)})`;
  }
  if (expr instanceof CastExpr) {
    return `CAST(${render(expr.expr)} AS ${expr.targetType})`;
  }
  if (expr instanceof ColumnRef) {
    return `"${expr.table}"."${expr.column}"`;
  }
  throw new Error(`Aggregate conformance cannot render a '${expr.kind}' expression.`);
}

/** The SQL a resolved row computes with: the expression its lowering builds, and the plain call where it declares none. */
export function aggregateSql(request: AggregateSqlRequest): string {
  const { operation, lower, inputCodec, table, column } = request;
  const expr = column === undefined ? undefined : ColumnRef.of(table, column);
  if (lower === undefined) {
    return `${operation}(${expr === undefined ? '*' : render(expr)})`;
  }
  return render(lower({ expr, inputCodec }));
}

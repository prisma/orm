/**
 * Renders the SQL a resolved aggregate row computes with, so a probe measures
 * the expression that row actually runs.
 *
 * Every SQLite row whose result is an integer wider than a JS number reaches
 * the database through its lowering — a cast rendering the result as text for
 * the driver — and the lossless variants compute with the SQL aggregate their
 * bare namesakes use. A call named after the operation would therefore measure
 * something no query builds.
 *
 * That cast renders a result rather than choosing one, so which storage class
 * the result *has* is a question about the aggregate inside it:
 * {@link computedAggregateSql} strips the cast, and {@link aggregateSql} keeps
 * the whole expression as the driver receives it.
 */

import type { CodecRef } from '@internal/framework-components/codec';
import type {
  SqlAggregateLowering,
  SqlAggregateLoweringContext,
} from '@internal/sql-relational-core/aggregate-descriptor-registry';
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

function loweringContext(request: AggregateSqlRequest): SqlAggregateLoweringContext {
  const { inputCodec, table, column } = request;
  return { expr: column === undefined ? undefined : ColumnRef.of(table, column), inputCodec };
}

/** The plain call a row in the SQL aggregate alphabet makes where it declares no lowering. */
function plainCall(request: AggregateSqlRequest): string {
  const { operation, table, column } = request;
  return `${operation}(${column === undefined ? '*' : `"${table}"."${column}"`})`;
}

/** The SQL a resolved row computes with, as the driver receives it — the transport cast included. */
export function aggregateSql(request: AggregateSqlRequest): string {
  const { lower } = request;
  return lower === undefined ? plainCall(request) : render(lower(loweringContext(request)));
}

/** The same expression with its transport cast stripped: the aggregate call whose result class SQLite's own typing rules answer for. */
export function computedAggregateSql(request: AggregateSqlRequest): string {
  const { lower } = request;
  if (lower === undefined) return plainCall(request);
  const expr = lower(loweringContext(request));
  return render(expr instanceof CastExpr ? expr.expr : expr);
}

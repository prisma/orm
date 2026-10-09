import type { SqlOperationEntry } from '@internal/sql-operations';
import { AggregateExpr, type CodecRef, isAggregateFn } from '@internal/sql-relational-core/ast';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import { createFunctions, ExpressionImpl } from '@internal/sql-relational-core/functions';
import type { SqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import type { AggregateFunctions, Expression } from '../expression';
import type { QueryContext, ScopeField } from '../scope';
import { ProjectionOnlyExpressionImpl } from './expression-impl';

/**
 * Build an aggregate through the target's own answer for it.
 *
 * What an aggregate returns is neither the input's codec nor a fixed id: a
 * target widens `sum` over small integers, takes `avg` somewhere else again,
 * and may want the result rendered a particular way. All three come from the
 * registry, and the result carries the codec it declared so decoding resolves
 * through the ordinary path.
 *
 * The declared rendering (`lower`) exists to carry the value across the driver
 * boundary — a projection concern. It is carried beside the plain form so only
 * the projection site consumes it; HAVING and ORDER BY compare the value inside
 * the database, where the rendering would change SQL semantics (SQLite's
 * `CAST(count(*) AS TEXT)` compares and sorts lexicographically).
 *
 * A pair the target declares no overload for is rejected outright. The typed
 * surface already makes it inexpressible; this backs that up for dynamic
 * invocation, instead of executing SQL whose result no declaration types or
 * decodes — SQLite's `sum` over text, which reads whatever leading numbers the
 * rows happened to hold, is the shape of value that path would hand back.
 *
 * An operation outside the SQL aggregate alphabet has no plain form at all:
 * its whole expression is what the lowering hook builds, so the result is
 * projection-only and refuses predicate and ordering positions.
 */
function aggregate(
  aggregates: SqlAggregateDescriptorRegistry,
  operation: string,
  expr: Expression<ScopeField> | undefined,
): ExpressionImpl<{ codecId: string; nullable: boolean; codec?: CodecRef }> {
  const field = expr?.returnType;
  const inputCodec = field === undefined ? undefined : (field.codec ?? { codecId: field.codecId });
  const resolved = aggregates.resolve(operation, inputCodec);
  if (resolved === undefined) {
    throw structuredError(
      'ORM.AGGREGATE_UNSUPPORTED',
      inputCodec === undefined
        ? `The composed target declares no '${operation}' aggregate for a call without an input.`
        : `The composed target declares no '${operation}' aggregate over codec '${inputCodec.codecId}'.`,
      {
        why: 'An aggregate result decodes through the codec its target declares; an undeclared pair has no declared result to type or decode.',
        fix: `Aggregate an input the target declares '${operation}' for, or contribute an aggregate descriptor for this pair.`,
        meta: { operation, ...ifDefined('inputCodecId', inputCodec?.codecId) },
      },
    );
  }
  const inputAst = expr?.buildAst();
  const returnType = {
    codecId: resolved.output.codecId,
    nullable: resolved.nullable,
    codec: resolved.output,
  };

  if (!isAggregateFn(operation)) {
    assertDefined(
      resolved.lower,
      `registry resolved '${operation}' outside the SQL aggregate alphabet without a lowering hook`,
    );
    return new ProjectionOnlyExpressionImpl(
      operation,
      resolved.lower({ expr: inputAst, inputCodec }),
      returnType,
    );
  }

  const ast = new AggregateExpr(operation, inputAst);
  const projectionAst = resolved.lower?.({ expr: inputAst, inputCodec });

  return new ExpressionImpl(ast, returnType, projectionAst);
}

/**
 * The aggregate implementations, one per operation the registry contributes,
 * erased.
 *
 * The method set is the registry's operation vocabulary — the runtime mirror
 * of the contract's emitted aggregate map, both settled from the same
 * contributed descriptors. What each returns is the contract's answer — a
 * function of the target's map and the input's codec — which no runtime value
 * can state. The typed surface is `AggregateFunctions<QC>`, applied where
 * these are handed out.
 */
function createAggregateOnlyFunctions(
  aggregates: SqlAggregateDescriptorRegistry,
): Record<string, (expr?: Expression<ScopeField>) => ExpressionImpl> {
  const methods = new Map<string, (expr?: Expression<ScopeField>) => ExpressionImpl>();
  for (const { operation } of aggregates.values()) {
    if (methods.has(operation)) continue;
    methods.set(operation, (expr?: Expression<ScopeField>) =>
      aggregate(aggregates, operation, expr),
    );
  }
  return Object.fromEntries(methods);
}

export function createAggregateFunctions<QC extends QueryContext>(
  operations: Readonly<Record<string, SqlOperationEntry>>,
  rawCodecInferer: RawCodecInferer,
  aggregateRegistry: SqlAggregateDescriptorRegistry,
): AggregateFunctions<QC> {
  const baseFns = createFunctions<QC>(operations, rawCodecInferer);
  const aggregates = createAggregateOnlyFunctions(aggregateRegistry);

  return new Proxy(
    blindCast<
      AggregateFunctions<QC>,
      'proxy composes SQL functions with registered aggregate methods'
    >({}),
    {
      get(_target, prop: string) {
        if (Object.hasOwn(aggregates, prop)) {
          return aggregates[prop];
        }

        return blindCast<
          Record<string, unknown>,
          'base function proxy resolves dynamic method names'
        >(baseFns)[prop];
      },
    },
  );
}

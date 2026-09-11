import type { SqlOperationEntry } from '@internal/sql-operations';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression as AstExpression,
  BinaryExpr,
  type BinaryOp,
  type CodecRef,
  ExistsExpr,
  isAggregateFn,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import {
  codecOf,
  createRawSql,
  isExpression,
  toExpr,
} from '@internal/sql-relational-core/expression';
import type { SqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import type {
  AggregateFunctions,
  BooleanCodecType,
  BuiltinFunctions,
  CodecExpression,
  Expression,
  Functions,
} from '../expression';
import type { QueryContext, ScopeField, Subquery } from '../scope';
import { ExpressionImpl, ProjectionOnlyExpressionImpl } from './expression-impl';

type CodecTypes = Record<string, { readonly input: unknown }>;
// Runtime-level ExprOrVal — accepts any codec, any nullability. Concrete codec typing lives on the public BuiltinFunctions surface in `../expression`.
type ExprOrVal<CodecId extends string = string, N extends boolean = boolean> = CodecExpression<
  CodecId,
  N,
  CodecTypes
>;

const BOOL_FIELD: BooleanCodecType = { codecId: 'pg/bool@1', nullable: false };

const resolve = toExpr;

/**
 * Resolve a binary-comparison operand into an AST expression, threading the column-bound side's {@link CodecRef} to the raw-value side.
 *
 * For `fns.eq(f.email, 'alice@example.com')`, `f.email` is the column-bound expression carrying a `ColumnRef` AST and a `CodecRef` derived from contract storage; the raw string operand has no codec context. By deriving the codec context from the column-bound side and forwarding it via `toExpr(value, codec)`, the resulting `ParamRef` carries the `CodecRef` that encode-side dispatch needs to materialise the per-instance codec for parameterized codec ids (`vector(1024)` vs. `vector(1536)`).
 */
function resolveOperand(operand: ExprOrVal, otherCodec?: CodecRef): AstExpression {
  if (isExpression(operand)) return operand.buildAst();
  return toExpr(operand, otherCodec);
}

/**
 * Resolves an Expression via `buildAst()`, or wraps a raw value as a `LiteralExpr` — an SQL literal inlined into the query text, not a bound parameter.
 *
 * Used for `and` / `or` operands. The usual operand is an `Expression<bool>` (e.g. the result of `fns.eq`), which this function passes through by calling `buildAst()`. The only time the raw-value branch fires is when the caller writes `fns.and(true, x)` or similar — inlining `TRUE`/`FALSE` literals lets the SQL planner statically simplify `TRUE AND x` to `x`, which it cannot do for an opaque `ParamRef`.
 */
function toLiteralExpr(value: unknown): AstExpression {
  if (isExpression(value)) {
    return value.buildAst();
  }
  return new LiteralExpr(value);
}

function boolExpr(astNode: AstExpression): ExpressionImpl<BooleanCodecType> {
  return new ExpressionImpl(astNode, BOOL_FIELD);
}

function binaryWithSharedCodec(
  a: ExprOrVal,
  b: ExprOrVal,
  build: (left: AstExpression, right: AstExpression) => AstExpression,
): AstExpression {
  const aCodec = codecOf(a);
  const bCodec = codecOf(b);
  const left = resolveOperand(a, bCodec);
  const right = resolveOperand(b, aCodec);
  return build(left, right);
}

function eq(a: ExprOrVal, b: ExprOrVal): ExpressionImpl<BooleanCodecType> {
  if (b === null) return boolExpr(NullCheckExpr.isNull(resolve(a)));
  if (a === null) return boolExpr(NullCheckExpr.isNull(resolve(b)));
  return boolExpr(binaryWithSharedCodec(a, b, (l, r) => new BinaryExpr('eq', l, r)));
}

function ne(a: ExprOrVal, b: ExprOrVal): ExpressionImpl<BooleanCodecType> {
  if (b === null) return boolExpr(NullCheckExpr.isNotNull(resolve(a)));
  if (a === null) return boolExpr(NullCheckExpr.isNotNull(resolve(b)));
  return boolExpr(binaryWithSharedCodec(a, b, (l, r) => new BinaryExpr('neq', l, r)));
}

function comparison(a: ExprOrVal, b: ExprOrVal, op: BinaryOp): ExpressionImpl<BooleanCodecType> {
  return boolExpr(binaryWithSharedCodec(a, b, (l, r) => new BinaryExpr(op, l, r)));
}

function inOrNotIn(
  expr: Expression<ScopeField>,
  valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
  op: 'in' | 'notIn',
): ExpressionImpl<BooleanCodecType> {
  const left = expr.buildAst();
  const leftCodec = codecOf(expr);
  const binaryFn = op === 'in' ? BinaryExpr.in : BinaryExpr.notIn;

  if (Array.isArray(valuesOrSubquery)) {
    const refs = valuesOrSubquery.map((v) => resolveOperand(v, leftCodec));
    return boolExpr(binaryFn(left, ListExpression.of(refs)));
  }
  return boolExpr(binaryFn(left, SubqueryExpr.of(valuesOrSubquery.buildAst())));
}

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

  return new ExpressionImpl(ast, returnType, undefined, projectionAst);
}

function createBuiltinFunctions(rawCodecInferer: RawCodecInferer) {
  return {
    eq: (a: ExprOrVal, b: ExprOrVal) => eq(a, b),
    ne: (a: ExprOrVal, b: ExprOrVal) => ne(a, b),
    gt: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'gt'),
    gte: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'gte'),
    lt: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'lt'),
    lte: (a: ExprOrVal, b: ExprOrVal) => comparison(a, b, 'lte'),
    and: (...exprs: ExprOrVal<'pg/bool@1', boolean>[]) =>
      boolExpr(AndExpr.of(exprs.map(toLiteralExpr))),
    or: (...exprs: ExprOrVal<'pg/bool@1', boolean>[]) =>
      boolExpr(OrExpr.of(exprs.map(toLiteralExpr))),
    exists: (subquery: Subquery<Record<string, ScopeField>>) =>
      boolExpr(ExistsExpr.exists(subquery.buildAst())),
    notExists: (subquery: Subquery<Record<string, ScopeField>>) =>
      boolExpr(ExistsExpr.notExists(subquery.buildAst())),
    in: (
      expr: Expression<ScopeField>,
      valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
    ) => inOrNotIn(expr, valuesOrSubquery, 'in'),
    notIn: (
      expr: Expression<ScopeField>,
      valuesOrSubquery: Subquery<Record<string, ScopeField>> | ExprOrVal[],
    ) => inOrNotIn(expr, valuesOrSubquery, 'notIn'),
    raw: createRawSql(rawCodecInferer),
  } satisfies BuiltinFunctions<CodecTypes>;
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

export function createFunctions<QC extends QueryContext>(
  operations: Readonly<Record<string, SqlOperationEntry>>,
  rawCodecInferer: RawCodecInferer,
): Functions<QC> {
  const builtins = createBuiltinFunctions(rawCodecInferer);

  return new Proxy(
    blindCast<Functions<QC>, 'proxy exposes built-in and registered SQL functions dynamically'>({}),
    {
      get(_target, prop: string) {
        if (Object.hasOwn(builtins, prop)) {
          return blindCast<
            Record<string, unknown>,
            'built-in function names are checked as own properties'
          >(builtins)[prop];
        }

        const op = operations[prop];
        if (op) return op.impl;
        return undefined;
      },
    },
  );
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

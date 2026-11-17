import type { QueryOperationTypesBase } from '@internal/sql-contract/types';
import type { SqlOperationEntry } from '@internal/sql-operations';
import { blindCast } from '@internal/utils/casts';
import type { CodecRef } from './ast/codec-types';
import {
  AndExpr,
  type AnyExpression as AstExpression,
  BinaryExpr,
  type BinaryOp,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
  type SelectAst,
  SubqueryExpr,
} from './ast/types';
import {
  type CodecExpression,
  type CodecTypesBase,
  codecOf,
  createRawSql,
  type Expression,
  isExpression,
  type RawCodecInferer,
  type RawSqlTag,
  type ScopeField,
  toExpr,
} from './expression';
import { ExpressionImpl } from './expression-impl';

export type BooleanCodecType = { codecId: 'pg/bool@1'; nullable: boolean };

export declare const SubqueryMarker: unique symbol;

export type Subquery<RowType extends Record<string, ScopeField>> = {
  [SubqueryMarker]: RowType;
  buildAst(): SelectAst;
  getRowFields(): Record<string, ScopeField>;
};

/** What the function surface reads from a query context: the codec types and the registered query operations. */
export type FunctionsContext = {
  readonly codecTypes: CodecTypesBase;
  readonly queryOperationTypes: QueryOperationTypesBase;
};

type DeriveExtFunctions<OT extends QueryOperationTypesBase> = {
  [K in keyof OT]: OT[K]['impl'];
};

export type BuiltinFunctions<CT extends Record<string, { readonly input: unknown }>> = {
  eq: <CodecId extends string>(
    a: CodecExpression<CodecId, boolean, CT> | null,
    b: CodecExpression<CodecId, boolean, CT> | null,
  ) => Expression<BooleanCodecType>;
  ne: <CodecId extends string, N extends boolean>(
    a: CodecExpression<CodecId, N, CT> | null,
    b: CodecExpression<CodecId, N, CT> | null,
  ) => Expression<BooleanCodecType>;
  gt: <CodecId extends string, N extends boolean>(
    a: CodecExpression<CodecId, N, CT>,
    b: CodecExpression<CodecId, N, CT>,
  ) => Expression<BooleanCodecType>;
  gte: <CodecId extends string, N extends boolean>(
    a: CodecExpression<CodecId, N, CT>,
    b: CodecExpression<CodecId, N, CT>,
  ) => Expression<BooleanCodecType>;
  lt: <CodecId extends string, N extends boolean>(
    a: CodecExpression<CodecId, N, CT>,
    b: CodecExpression<CodecId, N, CT>,
  ) => Expression<BooleanCodecType>;
  lte: <CodecId extends string, N extends boolean>(
    a: CodecExpression<CodecId, N, CT>,
    b: CodecExpression<CodecId, N, CT>,
  ) => Expression<BooleanCodecType>;
  and: (...ands: CodecExpression<'pg/bool@1', boolean, CT>[]) => Expression<BooleanCodecType>;
  or: (...ors: CodecExpression<'pg/bool@1', boolean, CT>[]) => Expression<BooleanCodecType>;

  exists: (subquery: Subquery<Record<string, ScopeField>>) => Expression<BooleanCodecType>;
  notExists: (subquery: Subquery<Record<string, ScopeField>>) => Expression<BooleanCodecType>;

  in: {
    <CodecId extends string>(
      expr: Expression<{ codecId: CodecId; nullable: boolean }>,
      subquery: Subquery<Record<string, { codecId: CodecId; nullable: boolean }>>,
    ): Expression<BooleanCodecType>;
    <CodecId extends string>(
      expr: Expression<{ codecId: CodecId; nullable: boolean }>,
      values: Array<CodecExpression<CodecId, boolean, CT>>,
    ): Expression<BooleanCodecType>;
  };

  notIn: {
    <CodecId extends string>(
      expr: Expression<{ codecId: CodecId; nullable: boolean }>,
      subquery: Subquery<Record<string, { codecId: CodecId; nullable: boolean }>>,
    ): Expression<BooleanCodecType>;
    <CodecId extends string>(
      expr: Expression<{ codecId: CodecId; nullable: boolean }>,
      values: Array<CodecExpression<CodecId, boolean, CT>>,
    ): Expression<BooleanCodecType>;
  };

  readonly raw: RawSqlTag;
};

/** The functions a query's callbacks receive: the built-in ones and every query operation the contract's target and extensions register. */
export type Functions<QC extends FunctionsContext> = BuiltinFunctions<QC['codecTypes']> &
  DeriveExtFunctions<QC['queryOperationTypes']>;

type CodecTypes = Record<string, { readonly input: unknown }>;
// Runtime-level ExprOrVal — accepts any codec, any nullability. Concrete codec typing lives on the public BuiltinFunctions surface.
type ExprOrVal<CodecId extends string = string, N extends boolean = boolean> = CodecExpression<
  CodecId,
  N,
  CodecTypes
>;

const BOOL_FIELD: BooleanCodecType = { codecId: 'pg/bool@1', nullable: false };

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
  if (b === null) return boolExpr(NullCheckExpr.isNull(toExpr(a)));
  if (a === null) return boolExpr(NullCheckExpr.isNull(toExpr(b)));
  return boolExpr(binaryWithSharedCodec(a, b, (l, r) => new BinaryExpr('eq', l, r)));
}

function ne(a: ExprOrVal, b: ExprOrVal): ExpressionImpl<BooleanCodecType> {
  if (b === null) return boolExpr(NullCheckExpr.isNotNull(toExpr(a)));
  if (a === null) return boolExpr(NullCheckExpr.isNotNull(toExpr(b)));
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
 * The function surface for a contract: the built-in functions, and each registered query operation's implementation under its name.
 */
export function createFunctions<QC extends FunctionsContext>(
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

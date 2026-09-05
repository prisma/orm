import type { QueryOperationTypesBase } from '@internal/sql-contract/types';
import type { Direction, OrderByNulls } from '@internal/sql-relational-core/ast';
import type {
  CodecExpression,
  Expression,
  RawSqlTag,
  TraitExpression,
} from '@internal/sql-relational-core/expression';
import type { Expand, QueryContext, Scope, ScopeField, ScopeTable, Subquery } from './scope';

export type { CodecExpression, Expression, RawSqlTag, TraitExpression };

export type BooleanCodecType = { codecId: 'pg/bool@1'; nullable: boolean };

export type WithField<Source, Field extends ScopeField, Alias extends string> = Expand<
  Source & { [K in Alias]: Field }
>;

export type WithFields<
  Source,
  FromScope extends ScopeTable,
  Columns extends readonly (keyof FromScope)[],
> = Expand<Source & Pick<FromScope, Columns[number]>>;

export type ExtractScopeFields<T extends Record<string, Expression<ScopeField>>> = {
  [K in keyof T]: T[K] extends Expression<infer F extends ScopeField> ? F : never;
};

export type FieldProxy<AvailableScope extends Scope> = {
  [K in keyof AvailableScope['topLevel']]: Expression<AvailableScope['topLevel'][K]>;
} & {
  [TableName in keyof AvailableScope['namespaces']]: {
    [K in keyof AvailableScope['namespaces'][TableName]]: Expression<
      AvailableScope['namespaces'][TableName][K]
    >;
  };
};

export type ExpressionBuilder<AvailableScope extends Scope, QC extends QueryContext> = (
  fields: FieldProxy<AvailableScope>,
  fns: Functions<QC>,
) => Expression<BooleanCodecType>;

export type OrderByDirection = Direction;

export type OrderByOptions = {
  direction?: OrderByDirection;
  nulls?: OrderByNulls;
};

export type OrderByScope<
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> = {
  topLevel: Expand<AvailableScope['topLevel'] & RowType>;
  namespaces: AvailableScope['namespaces'];
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

export type Functions<QC extends QueryContext> = BuiltinFunctions<QC['codecTypes']> &
  DeriveExtFunctions<QC['queryOperationTypes']>;

/**
 * The field an aggregate produces, read from the contract's emitted aggregate map.
 *
 * The map is settled per input codec at emit time, so this is two lookups: the
 * row for the input's codec, else the row that answers any input; and for a call
 * with no input, the row for that. What a target widens, preserves, or renames
 * is its own answer — this states it rather than restating the input.
 */
type AggregateField<QC extends QueryContext, Op extends string, InputCodecId> =
  AggregateRow<QC, Op, InputCodecId> extends {
    readonly output: infer Output extends string;
    readonly nullable: infer Nullable extends boolean;
  }
    ? { codecId: Output; nullable: Nullable }
    : ScopeField;

type AggregateRow<
  QC extends QueryContext,
  Op extends string,
  InputCodecId,
> = Op extends keyof QC['aggregateTypes']
  ? [InputCodecId] extends [never]
    ? WithoutInputRow<QC['aggregateTypes'][Op]>
    : InputCodecId extends keyof ByCodecRows<QC['aggregateTypes'][Op]>
      ? ByCodecRows<QC['aggregateTypes'][Op]>[InputCodecId]
      : AnyInputRow<QC['aggregateTypes'][Op]>
  : never;

type ByCodecRows<Operation> = Operation extends { readonly byCodec: infer Rows } ? Rows : never;
type AnyInputRow<Operation> = Operation extends { readonly anyInput: infer Row } ? Row : never;
type WithoutInputRow<Operation> = Operation extends { readonly withoutInput: infer Row }
  ? Row
  : never;

declare const aggregateUnavailable: unique symbol;

/**
 * The impossible operand an aggregate call demands when the contract's
 * aggregate map declares no row for the operation and input. Intersecting it
 * with the operand type turns an undeclared pair into a call-site type error
 * that names the reason, instead of an expression whose runtime value the
 * target never declared.
 */
export interface AggregateUnavailable<Op extends string> {
  readonly [aggregateUnavailable]: `the composed target declares no '${Op}' aggregate for this input`;
}

type AggregateOperand<
  QC extends QueryContext,
  Op extends string,
  T extends ScopeField,
> = Expression<T> &
  (AggregateRow<QC, Op, T['codecId']> extends never ? AggregateUnavailable<Op> : unknown);

type FieldTakingAggregateMethod<QC extends QueryContext, Op extends string> = <
  T extends ScopeField,
>(
  expr: AggregateOperand<QC, Op, T>,
) => Expression<AggregateField<QC, Op, T['codecId']>>;

/**
 * One derived aggregate method. Its arities are read off the operation's row
 * presence in the aggregate map: a `withoutInput` row admits the
 * zero-argument call (resolved through that row), and the field-taking call
 * types through `byCodec[input] ?? anyInput` — an input no row claims is
 * rejected at the call site via {@link AggregateUnavailable}. An operation
 * with both shapes carries both overloads; `count()` vs `count(expr)` is one
 * such data fact, not a special case.
 */
type AggregateMethod<QC extends QueryContext, Op extends string> = [
  AggregateRow<QC, Op, never>,
] extends [never]
  ? FieldTakingAggregateMethod<QC, Op>
  : {
      (): Expression<AggregateField<QC, Op, never>>;
      <T extends ScopeField>(
        expr: AggregateOperand<QC, Op, T>,
      ): Expression<AggregateField<QC, Op, T['codecId']>>;
    };

/** The operation names the context's aggregate map declares. */
type AggregateOperationNames<QC extends QueryContext> = keyof QC['aggregateTypes'] & string;

declare const aggregateOperationsUnavailable: unique symbol;

/**
 * The aggregate surface a context whose aggregate map is unknown resolves to. It declares no
 * operation, and the optional symbol-keyed brand names the reason at the call site while leaving
 * the members and the assignability of any surface it intersects with untouched.
 */
export interface AggregateOperationsUnavailable {
  readonly [aggregateOperationsUnavailable]?: 'the composed target declares no aggregate operations';
}

/**
 * The aggregate surface: one method per operation the contract's aggregate
 * map declares, named by the map's keys. The method set, each method's
 * arities, and each result's identity all derive from the map — an operation
 * the map does not declare is no method at all, and a context whose map is
 * unknown resolves to {@link AggregateOperationsUnavailable}, which keeps an
 * index signature off the surface.
 */
export type AggregateOnlyFunctions<QC extends QueryContext> =
  string extends AggregateOperationNames<QC>
    ? AggregateOperationsUnavailable
    : {
        [Op in AggregateOperationNames<QC>]: AggregateMethod<QC, Op>;
      };

export type AggregateFunctions<QC extends QueryContext> = Functions<QC> &
  AggregateOnlyFunctions<QC>;

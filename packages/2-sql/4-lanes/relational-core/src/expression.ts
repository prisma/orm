import type { Contract } from '@internal/contract/types';
import { runtimeError } from '@internal/framework-components/runtime';
import type { ParamSpec } from '@internal/operations';
import type { QueryOperationReturn, SqlStorage } from '@internal/sql-contract/types';
import type { SqlLoweringSpec } from '@internal/sql-operations';
import { invariant } from '@internal/utils/assertions';
import type { CodecRef } from './ast/codec-types';
import type { SqlStatementStats } from './ast/driver-types';
import type { AnyExpression as AstExpression, RawQueryColumn, RawSqlLiteral } from './ast/types';
import { OperationExpr, ParamRef, RawExpr, RawQueryAst } from './ast/types';
import { planFromAst, type SqlQueryPlan } from './plan';

export type ScopeField = {
  codecId: string;
  nullable: boolean;
  /**
   * Marks a list-typed (scalar-array) field. When `true`, the field is an
   * array of `codecId`-typed elements; list operations target it and the
   * element type is `codecId`. Absent/`false` for scalar fields. Carried so
   * `X` and `X[]` stay distinct at the type level (a list expression is not
   * assignable to a scalar `CodecExpression` slot).
   */
  many?: boolean;
  /**
   * Optional {@link CodecRef} derived from contract storage at scope construction time. Builder paths that mint column-bound `ParamRef` / `ProjectionItem` nodes stamp this slot onto the AST so encode/decode dispatch resolves through `contractCodecs.forCodecRef`. Leave `undefined` when the scope was built without contract storage (rare — tests, ad-hoc scopes).
   */
  codec?: CodecRef;
};

export type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

/**
 * A typed SQL expression. Identity is carried by the `returnType` descriptor (inherited from `QueryOperationReturn` and narrowed to `T`) — distinct `T` makes distinct Expression types structurally. `buildAst()` materialises the underlying AST node.
 */
export type Expression<T extends ScopeField> = QueryOperationReturn & {
  readonly returnType: T;
  buildAst(): AstExpression;
};

type CodecIdsWithTrait<
  CT extends Record<string, { readonly input: unknown }>,
  RequiredTraits extends readonly string[],
> = {
  [K in keyof CT & string]: CT[K] extends { readonly traits: infer T }
    ? [RequiredTraits[number]] extends [T]
      ? K
      : never
    : never;
}[keyof CT & string];

type NullSuffix<N> = N extends true ? null : never;

/**
 * Runtime value type for a slot bound to `CodecId` with the given
 * nullability — `CT[CodecId]['input']`, plus `null` when `Nullable` is true.
 */
export type CodecValue<
  CodecId extends string,
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> = (CodecId extends keyof CT ? CT[CodecId]['input'] : never) | NullSuffix<Nullable>;

/**
 * An expression or literal value targeting a specific codec.
 *
 * Accepts any of:
 * - An `Expression` whose codec matches exactly
 * - A raw JS value of the codec's `input` type
 * - `null` when `Nullable` is true
 *
 * `many?: never` makes this a *scalar* slot: a list expression (whose
 * `returnType` carries `many: true`) is rejected here, while scalar
 * expressions — which carry no `many` key at all — pass unchanged. The
 * discriminant lives on this operand slot, so scalar expression and scope
 * types never have to spell out `many: false`.
 */
export type CodecExpression<
  CodecId extends string,
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> =
  | Expression<{ codecId: CodecId; nullable: Nullable; many?: never }>
  | CodecValue<CodecId, Nullable, CT>;

/**
 * A list-typed expression: an {@link Expression} whose element codec is
 * `CodecId` and whose `returnType` carries `many: true`. The element identity
 * is the codec id, so list operations stay generic over the element type while
 * tying any element argument back to this list's `CodecId`.
 */
export type ScalarListExpression<CodecId extends string, Nullable extends boolean> = Expression<{
  codecId: CodecId;
  nullable: Nullable;
  many: true;
}>;

/**
 * An expression or literal value targeting any codec whose trait set contains all the required traits.
 *
 * Resolves the trait set to the union of matching codec identities via `CodecIdsWithTrait`, then reuses `CodecExpression` for the codec-id form.
 */
export type TraitExpression<
  Traits extends readonly string[],
  Nullable extends boolean,
  CT extends Record<string, { readonly input: unknown }>,
> = CodecExpression<CodecIdsWithTrait<CT, Traits>, Nullable, CT>;

/**
 * Resolve a raw value or an Expression into an AST expression node.
 *
 * When `value` is an Expression (duck-typed by its `buildAst` method), the AST it wraps is returned. Otherwise the value is embedded as a ParamRef tagged with the caller-supplied {@link CodecRef} (when known). The runtime resolves the ref via `contractCodecs.forCodecRef(codec)`; content-keyed memoisation collapses repeated lookups for the same logical column onto one shared codec.
 *
 * Operation implementations that compare a column-bound expression to a user value derive the column's {@link CodecRef} from the column-bound side (via {@link codecOf}) and forward it here so encode-side dispatch resolves to the per-instance codec for parameterized codec ids (`vector(1024)` vs. `vector(1536)`).
 */
export function toExpr(value: unknown, codec?: CodecRef): AstExpression {
  if (isExpressionLike(value)) {
    return value.buildAst();
  }
  if (codec === undefined) {
    throw runtimeError(
      'RUNTIME.PARAM_REF_CODEC_REQUIRED',
      `Cannot construct a ParamRef for a ${value === null ? 'null' : typeof value} value without an explicit codec. ` +
        'Provide a CodecRef at the call site or use a column-bound builder path.',
    );
  }
  return ParamRef.of(value, { codec });
}

/**
 * Construct a `ParamRef` for a value whose codec identity is known at call time. Use this when interpolating a value into a raw SQL expression and the codec cannot be inferred from context — e.g. `param(myDate, { codecId: 'pg/timestamptz-temporal@1' })`.
 */
export function param<T>(value: T, opts: { codecId: string }): ParamRef {
  return ParamRef.of(value, { codec: { codecId: opts.codecId } });
}

/**
 * Derive the {@link CodecRef} carried by an expression-like value.
 *
 * Resolution order:
 * 1. `wrapper.codec` — explicit column-bound {@link CodecRef} stamped at field-proxy time.
 * 2. `wrapper.returnType.codec` — scope-level codec when the scope was built from contract storage.
 * 3. `{ codecId: wrapper.returnType.codecId }` — minimal ref derived from the expression's declared codec id (covers synthetic expressions like `count()` whose returnType has a known codec id but no explicit column binding).
 *
 * Returns `undefined` for raw scalar values (non-expression-like).
 */
export function codecOf(value: unknown): CodecRef | undefined {
  if (!isExpressionLike(value)) return undefined;
  const wrapper = value as {
    codec?: CodecRef;
    returnType?: { codec?: CodecRef; codecId?: string };
  };
  if (wrapper.codec) return wrapper.codec;
  if (wrapper.returnType?.codec) return wrapper.returnType.codec;
  if (wrapper.returnType?.codecId) return { codecId: wrapper.returnType.codecId };
  return undefined;
}

function isExpressionLike(value: unknown): value is Expression<ScopeField> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof (value as { buildAst: unknown }).buildAst === 'function'
  );
}

export interface BuildOperationSpec<R extends ScopeField> {
  readonly method: string;
  /**
   * The operation's arguments. The first element is the self argument (the value the operation is being applied to); the rest are the remaining user-supplied arguments.
   */
  readonly args: readonly [AstExpression, ...AstExpression[]];
  readonly returns: R & ParamSpec;
  readonly lowering: SqlLoweringSpec;
}

/**
 * Construct an OperationExpr AST node and wrap it as a typed Expression. Operation implementations use this to turn their user-facing arguments into the AST node the compilation pipeline eventually lowers to SQL.
 */
export function buildOperation<R extends ScopeField>(spec: BuildOperationSpec<R>): Expression<R> {
  const [self, ...rest] = spec.args;
  const op = new OperationExpr({
    method: spec.method,
    self,
    args: rest.length > 0 ? rest : undefined,
    returns: spec.returns,
    lowering: spec.lowering,
  });
  return {
    returnType: spec.returns,
    buildAst: () => op,
  };
}

/**
 * Resolves a codec id for a bare JavaScript value interpolated into a raw-SQL
 * template — e.g. `` rawSql`SELECT ${42}` `` calls `inferCodec(42)` to pick
 * the codec id (`pg/int4`, `sqlite/integer@1`, etc.) that will encode the
 * value as a bound parameter.
 *
 * Targets implement this once per dialect: examine the JS value's runtime
 * shape (number, bigint, string, boolean, `Uint8Array`) and return a codec
 * id known to the target's codec registry. Throw when the value falls
 * outside the supported set — callers should wrap such values with
 * `param(value, { codecId })` to declare the codec explicitly.
 */
export interface RawCodecInferer {
  inferCodec(value: RawSqlLiteral): string;
}

/** The one-method builder returned by a `RawSqlTag` template call before `.returns()` is called. */
export interface RawSqlBuilder {
  returns<S extends string>(spec: S): Expression<{ codecId: S; nullable: false }>;
  returns<S extends string, N extends boolean = false>(spec: {
    readonly codecId: S;
    readonly nullable?: N;
  }): Expression<{ codecId: S; nullable: N }>;
}

/**
 * One column of a raw query's declared result row, as authored: a codec id, or
 * a codec id plus nullability. Mirrors the contract-free lane's
 * `ColumnDescriptor`; contract-column references are sugar layered on top of
 * this form by the contract-typed builder.
 */
export type RawRowSpecEntry = string | { readonly codecId: string; readonly nullable?: boolean };

/**
 * Declares the one column name a row spec cannot use. TypeScript types
 * `{ __proto__: 'pg/int4@1' }` and `{ ['__proto__']: 'pg/int4@1' }` alike — as
 * a spec with a `__proto__` column — while JavaScript keeps the key in neither
 * object. Rejecting the name here is what makes the two agree; the AST refuses
 * the computed form again at runtime, where it does arrive.
 */
export type NoReservedRowColumn = {
  readonly __proto__?: 'A raw row spec cannot declare a __proto__ column: alias the column in SQL and declare the alias instead';
};

/** The declared result row of a raw query: result-column name to codec. */
export type RawRowSpec = Readonly<Record<string, RawRowSpecEntry>> & NoReservedRowColumn;

/**
 * Row type minted for a {@link RawRowSpec}. Column names carry through; the
 * per-column JS type is `unknown` here, where codec ids are opaque strings —
 * the contract-typed builder resolves them against the contract's codec map.
 */
export type RawRow<Spec extends RawRowSpec> = { readonly [K in keyof Spec]: unknown };

/**
 * What a raw statement needs in order to mint a plan: the contract the plan's
 * metadata is sourced from, and the lane the plan is tagged with.
 */
export interface RawPlanContext {
  readonly contract: Contract<SqlStorage>;
  readonly laneId?: string;
}

/**
 * A raw query that returns rows, terminated by `.returnsRow(spec)`.
 *
 * Row-returning raw queries are embeddable: interpolating one into another raw
 * template splices its parts in, which is what makes derived tables and CTEs
 * (including data-modifying CTEs, whose `RETURNING` is what earns them a row
 * spec) expressible.
 */
export interface RawRowQuery<
  Row = unknown,
  Refs extends Readonly<Record<string, RawQueryColumn>> = Readonly<Record<string, RawQueryColumn>>,
> {
  /**
   * What this statement declared. Each spec key gets one entry naming the
   * codec that decodes the column and whether it may be null.
   *
   * Those entries are row-spec entries themselves. An outer statement that
   * embeds this one can inherit a declaration instead of restating its codec
   * id.
   */
  readonly returns: Refs;
  buildAst(): RawQueryAst;
  build(): SqlQueryPlan<Row>;
}

declare const affectedCountResult: unique symbol;

/**
 * The row type of a plan that reports how many rows a statement affected.
 *
 * The brand is what a consumer keys on to tell such a plan from one that
 * returns rows: the statistics shape alone cannot carry that meaning, because
 * a row spec is free to declare a column named `affectedRows`. Nothing holds
 * the brand at runtime — `_row` is phantom — so declaring it required costs
 * nothing and makes the claim unforgeable by coincidence.
 */
export interface AffectedCount extends SqlStatementStats {
  readonly [affectedCountResult]: true;
}

/**
 * A raw statement that reports how many rows it affected, terminated by
 * `.affectedCount()`. It is not an expression and carries no row spec, so it
 * is not embeddable — a mutation reaches expression position only through
 * `RETURNING` and `.returnsRow()`.
 */
export interface RawAffectedCountQuery {
  build(): SqlQueryPlan<AffectedCount>;
}

/**
 * The builder returned by a raw template that can also terminate in statement
 * position. `returns*` terminators yield something usable where expressions
 * go; `.affectedCount()` yields a plan handle only.
 */
export interface RawSqlStatementBuilder extends RawSqlBuilder {
  returnsRow<Spec extends RawRowSpec>(spec: Spec): RawRowQuery<RawRow<Spec>>;
  affectedCount(): RawAffectedCountQuery;
}

/** Tagged-template function returned by {@link createRawSql}. */
export type RawSqlTag = (
  strings: TemplateStringsArray,
  ...values: RawSqlInterpolation[]
) => RawSqlBuilder;

/** Tagged-template function returned by {@link createRawSql} when given a {@link RawPlanContext}. */
export type RawSqlStatementTag = (
  strings: TemplateStringsArray,
  ...values: RawSqlInterpolation[]
) => RawSqlStatementBuilder;

/** Interpolations that occupy a single position in the parts list. */
type RawExprInterpolation = Expression<ScopeField> | ParamRef | RawSqlLiteral;

/** Interpolations a raw template accepts; a {@link RawRowQuery} splices its own parts in. */
export type RawSqlInterpolation = RawExprInterpolation | RawRowQuery;

function resolveInterpolation(
  adapter: RawCodecInferer,
  value: RawExprInterpolation,
): AstExpression | ParamRef {
  if (isExpressionLike(value)) {
    return value.buildAst();
  }
  if (value instanceof ParamRef) {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    value instanceof Uint8Array
  ) {
    return ParamRef.of(value, { codec: { codecId: adapter.inferCodec(value) } });
  }

  value satisfies never;
  throw runtimeError(
    'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION',
    'unsupported JS value type for raw-SQL interpolation: wrap this value in `param(...)` with an explicit codec',
  );
}

function isRawRowQuery(value: unknown): value is RawRowQuery {
  return (
    typeof value === 'object' &&
    value !== null &&
    'buildAst' in value &&
    typeof value.buildAst === 'function' &&
    'build' in value &&
    typeof value.build === 'function'
  );
}

function templateParts(
  adapter: RawCodecInferer,
  strings: TemplateStringsArray,
  values: readonly RawSqlInterpolation[],
): Array<string | AstExpression> {
  const parts: Array<string | AstExpression> = [strings[0] ?? ''];
  values.forEach((value, i) => {
    if (isRawRowQuery(value)) {
      parts.push(...value.buildAst().parts);
    } else {
      parts.push(resolveInterpolation(adapter, value));
    }
    parts.push(strings[i + 1] ?? '');
  });
  return parts;
}

/**
 * Normalizes each authored entry to a {@link RawQueryColumn}. The record is
 * assembled with `Object.fromEntries`, which defines each key as an own
 * property: a spec built at runtime with a `__proto__` key reaches the AST,
 * which refuses it by name, rather than silently setting the record's
 * prototype and leaving the column to vanish.
 */
function resolveRowSpec(spec: RawRowSpec): Record<string, RawQueryColumn> {
  return Object.fromEntries(
    Object.entries(spec).map(([name, entry]) => [
      name,
      typeof entry === 'string'
        ? { codecId: entry, nullable: false }
        : { codecId: entry.codecId, nullable: entry.nullable ?? false },
    ]),
  );
}

/**
 * Create a tagged-template builder for raw SQL. The returned tag accepts SQL string fragments interleaved with typed {@link Expression}, {@link ParamRef}, row-returning {@link RawRowQuery}, or bare {@link RawSqlLiteral} interpolations. Call `.returns(spec)` on the result to obtain a typed {@link Expression} whose AST is a {@link RawExpr}.
 *
 * Supplied with a {@link RawPlanContext}, the tag also terminates in statement position: `.returnsRow(spec)` and `.affectedCount()` mint a {@link SqlQueryPlan} whose AST is a {@link RawQueryAst}. The context is stated once, here, so authoring sites carry nothing but the template and its terminator.
 *
 * Bare {@link RawSqlLiteral} interpolations are wrapped as `ParamRef` nodes with the codec resolved via `adapter.inferCodec(value)`. Use {@link param} when the codec cannot be inferred from the value alone (e.g. `Date`).
 */
export function createRawSql(
  adapter: RawCodecInferer,
  planContext: RawPlanContext,
): RawSqlStatementTag;
export function createRawSql(adapter: RawCodecInferer): RawSqlTag;
export function createRawSql(adapter: RawCodecInferer, planContext?: RawPlanContext): RawSqlTag {
  if (planContext === undefined) {
    return (strings, ...values) => new RawSqlBuilderImpl(templateParts(adapter, strings, values));
  }
  const context = planContext;
  return (strings, ...values) =>
    new RawSqlStatementBuilderImpl(templateParts(adapter, strings, values), context);
}

class RawSqlBuilderImpl implements RawSqlBuilder {
  constructor(protected readonly parts: readonly (string | AstExpression | ParamRef)[]) {}

  returns<S extends string>(spec: S): Expression<{ codecId: S; nullable: false }>;
  returns<S extends string, N extends boolean = false>(spec: {
    readonly codecId: S;
    readonly nullable?: N;
  }): Expression<{ codecId: S; nullable: N }>;
  returns(
    spec: string | { readonly codecId: string; readonly nullable?: boolean },
  ): Expression<{ codecId: string; nullable: boolean }> {
    const codecId = typeof spec === 'string' ? spec : spec.codecId;
    const nullable = typeof spec === 'string' ? false : (spec.nullable ?? false);
    const paramSpec: ParamSpec = { codecId, nullable };
    const node = new RawExpr({ parts: this.parts, returns: paramSpec });
    return {
      returnType: { codecId, nullable },
      buildAst: () => node,
    };
  }
}

class RawSqlStatementBuilderImpl extends RawSqlBuilderImpl implements RawSqlStatementBuilder {
  constructor(
    parts: readonly (string | AstExpression | ParamRef)[],
    private readonly planContext: RawPlanContext,
  ) {
    super(parts);
  }

  returnsRow<Spec extends RawRowSpec>(spec: Spec): RawRowQuery<RawRow<Spec>> {
    const node = RawQueryAst.rows(this.parts, resolveRowSpec(spec));
    // Publish the node's own result rather than a second copy. It is the
    // normalized spec, already frozen per column and built under the
    // reserved-name refusal. One record means what we publish cannot drift
    // from what the statement declared.
    const result = node.result;
    invariant(result.kind === 'rows', 'RawQueryAst.rows built a non-rows result');

    return {
      returns: result.columns,
      buildAst: () => node,
      build: () => this.planFor<RawRow<Spec>>(node),
    };
  }

  affectedCount(): RawAffectedCountQuery {
    const node = RawQueryAst.affectedCount(this.parts);
    return {
      build: () => this.planFor<AffectedCount>(node),
    };
  }

  private planFor<Row>(node: RawQueryAst): SqlQueryPlan<Row> {
    return planFromAst<Row>(node, this.planContext.contract, this.planContext.laneId);
  }
}

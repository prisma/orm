import type { ParamSpec } from '@internal/operations';
import type { SqlLoweringSpec } from '@internal/sql-operations';

import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { type CodecRef, frozenCodecRef } from './codec-types';
import type { AnyJsonValueProjection } from './json-value-projection';

export type Direction = 'asc' | 'desc';

/** Where NULLs sort relative to non-NULL values in an ORDER BY item. Undefined leaves placement to the target's default, and those defaults disagree: PostgreSQL ranks NULLs highest (last under ASC), SQLite ranks them lowest (first under ASC). State it explicitly to sort the same way on both. */
export type NullsPlacement = 'first' | 'last';

export type BinaryOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'like' | 'in' | 'notIn';

export type AggregateCountFn = 'count';
export type AggregateOpFn = 'sum' | 'avg' | 'min' | 'max';
export type AggregateFn = AggregateCountFn | AggregateOpFn;

/**
 * The closed SQL aggregate alphabet: every function name an {@link AggregateExpr} can carry, and so the set renderers are exhaustive over. Aggregate operation names are an open namespace; an operation outside the alphabet reaches SQL only through a descriptor's lowering hook, which builds its expression from existing nodes.
 */
export const aggregateFnNames: ReadonlySet<string> = new Set<AggregateFn>([
  'count',
  'sum',
  'avg',
  'min',
  'max',
]);

/** Whether `name` is in the closed SQL aggregate alphabet, and so lowers to a plain {@link AggregateExpr} without a descriptor-supplied hook. */
export function isAggregateFn(name: string): name is AggregateFn {
  return aggregateFnNames.has(name);
}

/**
 * Window function names. Currently only `row_number` is wired up — added
 * to support `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...) = 1`
 * lowering for `.distinct(cols)` semantics in the SQL ORM client. `rank`
 * and `dense_rank` are reserved here so future additions don't churn the
 * type; renderers only need to dispatch on the function name string.
 */
export type WindowFn = 'row_number' | 'rank' | 'dense_rank';

/** Scalar JS values that map directly to a SQL wire type. Values outside this set must be routed through `param(value, { codecId })` to declare the target codec explicitly. */
export type RawSqlLiteral = number | bigint | string | boolean | Uint8Array;

export interface ExpressionSource {
  toExpr(): AnyExpression;
}

export interface ExpressionRewriter {
  columnRef?(expr: ColumnRef): AnyExpression;
  identifierRef?(expr: IdentifierRef): AnyExpression;
  paramRef?(expr: ParamRef): ParamRef | LiteralExpr;
  preparedParamRef?(expr: PreparedParamRef): PreparedParamRef;
  literal?(expr: LiteralExpr): LiteralExpr;
  list?(expr: ListExpression): ListExpression | LiteralExpr;
  select?(ast: SelectAst): SelectAst;
  rawExpr?(expr: RawExpr): AnyExpression;
}

export interface AstRewriter extends ExpressionRewriter {
  tableSource?(source: TableSource): TableSource;
  eqColJoinOn?(on: EqColJoinOn): EqColJoinOn | AnyExpression;
}

export interface ExprVisitor<R> {
  columnRef(expr: ColumnRef): R;
  identifierRef(expr: IdentifierRef): R;
  subquery(expr: SubqueryExpr): R;
  operation(expr: OperationExpr): R;
  aggregate(expr: AggregateExpr): R;
  windowFunc(expr: WindowFuncExpr): R;
  functionCall(expr: FunctionCallExpr): R;
  cast(expr: CastExpr): R;
  case(expr: CaseExpr): R;
  jsonObject(expr: JsonObjectExpr): R;
  jsonArrayAgg(expr: JsonArrayAggExpr): R;
  binary(expr: BinaryExpr): R;
  and(expr: AndExpr): R;
  or(expr: OrExpr): R;
  exists(expr: ExistsExpr): R;
  nullCheck(expr: NullCheckExpr): R;
  not(expr: NotExpr): R;
  literal(expr: LiteralExpr): R;
  param(expr: ParamRef): R;
  preparedParam(expr: PreparedParamRef): R;
  list(expr: ListExpression): R;
  rawExpr(expr: RawExpr): R;
}

const toAnyExpressionVisitor: ExprVisitor<AnyExpression> = {
  columnRef: (expr) => expr,
  identifierRef: (expr) => expr,
  subquery: (expr) => expr,
  operation: (expr) => expr,
  aggregate: (expr) => expr,
  windowFunc: (expr) => expr,
  functionCall: (expr) => expr,
  cast: (expr) => expr,
  case: (expr) => expr,
  jsonObject: (expr) => expr,
  jsonArrayAgg: (expr) => expr,
  binary: (expr) => expr,
  and: (expr) => expr,
  or: (expr) => expr,
  exists: (expr) => expr,
  nullCheck: (expr) => expr,
  not: (expr) => expr,
  literal: (expr) => expr,
  param: (expr) => expr,
  preparedParam: (expr) => expr,
  list: (expr) => expr,
  rawExpr: (expr) => expr,
};

export interface ExpressionFolder<T> {
  empty: T;
  combine(a: T, b: T): T;
  isAbsorbing?(value: T): boolean;
  columnRef?(expr: ColumnRef): T;
  identifierRef?(expr: IdentifierRef): T;
  paramRef?(expr: ParamRef): T;
  preparedParamRef?(expr: PreparedParamRef): T;
  literal?(expr: LiteralExpr): T;
  list?(expr: ListExpression): T;
  select?(ast: SelectAst): T;
  rawExpr?(expr: RawExpr): T;
}

export type ProjectionExpr = AnyExpression;
export type InsertValue = ColumnRef | ParamRef | PreparedParamRef | DefaultValueExpr | RawExpr;
export type JoinOnExpr = EqColJoinOn | AnyExpression;
export type WhereArg = AnyExpression | ToWhereExpr;
export type JsonObjectEntry = {
  readonly key: string;
  readonly value: AnyJsonValueProjection;
};

function frozenArrayCopy<T>(values: readonly T[]): ReadonlyArray<T> {
  return Object.freeze([...values]);
}

function frozenOptionalRecordCopy<T extends Record<string, unknown>>(
  value: T | undefined,
): Readonly<T> | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function frozenRecordCopy<T>(record: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  return Object.freeze({ ...record });
}

function freezeRows(
  rows: ReadonlyArray<Record<string, InsertValue>>,
): ReadonlyArray<Readonly<Record<string, InsertValue>>> {
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function combineAll<T>(folder: ExpressionFolder<T>, thunks: Array<() => T>): T {
  let result = folder.empty;
  for (const thunk of thunks) {
    if (folder.isAbsorbing?.(result)) {
      return result;
    }
    result = folder.combine(result, thunk());
  }
  return result;
}

function rewriteComparable(value: AnyExpression, rewriter: ExpressionRewriter): AnyExpression {
  switch (value.kind) {
    case 'param-ref':
      return rewriter.paramRef ? rewriter.paramRef(value) : value;
    case 'prepared-param-ref':
      return rewriter.preparedParamRef ? rewriter.preparedParamRef(value) : value;
    case 'literal':
      return rewriter.literal ? rewriter.literal(value) : value;
    case 'list':
      if (rewriter.list) {
        return rewriter.list(value);
      }
      return value.rewrite(rewriter);
    default:
      return value.rewrite(rewriter);
  }
}

function foldComparable<T>(value: AnyExpression, folder: ExpressionFolder<T>): T {
  switch (value.kind) {
    case 'param-ref':
      return folder.paramRef ? folder.paramRef(value) : folder.empty;
    case 'prepared-param-ref':
      return folder.preparedParamRef ? folder.preparedParamRef(value) : folder.empty;
    case 'literal':
      return folder.literal ? folder.literal(value) : folder.empty;
    case 'list':
      return value.fold(folder);
    default:
      return value.fold(folder);
  }
}

function collectColumnRefsWith<TNode extends Expression>(node: TNode): ColumnRef[] {
  return node.fold<ColumnRef[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    columnRef: (columnRef) => [columnRef],
    select: (ast) => ast.collectColumnRefs(),
  });
}

function collectParamRefsWith<TNode extends Expression>(node: TNode): AnyParamRef[] {
  return node.fold<AnyParamRef[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    paramRef: (paramRef) => [paramRef],
    preparedParamRef: (paramRef) => [paramRef],
    select: (ast) => ast.collectParamRefs(),
  });
}

function rewriteTableSource(table: TableSource, rewriter: AstRewriter): TableSource {
  return rewriter.tableSource ? rewriter.tableSource(table) : table;
}

function rewriteProjectionItem(item: ProjectionItem, rewriter: AstRewriter): ProjectionItem {
  const rewrittenExpr =
    item.expr.kind === 'literal'
      ? rewriter.literal
        ? rewriter.literal(item.expr)
        : item.expr
      : item.expr.rewrite(rewriter);
  return new ProjectionItem(item.alias, rewrittenExpr, item.codec);
}

function rewriteInsertValue(value: InsertValue, rewriter: AstRewriter): InsertValue {
  switch (value.kind) {
    case 'param-ref':
      return rewriter.paramRef ? rewriteParamRefForInsert(value, rewriter) : value;
    case 'prepared-param-ref':
      return rewriter.preparedParamRef ? rewriter.preparedParamRef(value) : value;
    case 'column-ref':
      return rewriter.columnRef ? rewriteColumnRefForInsert(value, rewriter) : value;
    case 'default-value':
      return value;
    // RawExpr insert values are opaque DB-side expressions (e.g. `now()` /
    // `datetime('now')`) carried in value position; they are not a rewrite
    // target on the insert path.
    case 'raw-expr':
      return value;
  }
}

function rewriteParamRefForInsert(value: ParamRef, rewriter: AstRewriter): InsertValue {
  const rewritten = rewriter.paramRef ? rewriter.paramRef(value) : value;
  return rewritten.kind === 'param-ref' ? rewritten : value;
}

function rewriteColumnRefForInsert(value: ColumnRef, rewriter: AstRewriter): InsertValue {
  const rewritten = rewriter.columnRef ? rewriter.columnRef(value) : value;
  return rewritten.kind === 'column-ref' ? rewritten : value;
}

function rewriteInsertRow(
  row: Readonly<Record<string, InsertValue>>,
  rewriter: AstRewriter,
): Record<string, InsertValue> {
  const result: Record<string, InsertValue> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = rewriteInsertValue(value, rewriter);
  }
  return result;
}

function rewriteUpdateSet(
  set: Readonly<Record<string, AnyExpression>>,
  rewriter: AstRewriter,
): Record<string, AnyExpression> {
  const result: Record<string, AnyExpression> = {};
  for (const [key, value] of Object.entries(set)) {
    result[key] = value.rewrite(rewriter);
  }
  return result;
}

function rewriteLimitOffset<T extends number | AnyExpression | undefined>(
  value: T,
  rewriter: AstRewriter,
): T;
function rewriteLimitOffset(
  value: number | AnyExpression | undefined,
  rewriter: AstRewriter,
): number | AnyExpression | undefined {
  if (value === undefined || typeof value === 'number') return value;
  return value.rewrite(rewriter);
}

function rewriteOnConflict(onConflict: InsertOnConflict, rewriter: AstRewriter): InsertOnConflict {
  const columns = onConflict.columns.map((columnRef) => {
    const rewritten = rewriter.columnRef ? rewriter.columnRef(columnRef) : columnRef;
    return rewritten.kind === 'column-ref' ? rewritten : columnRef;
  });

  if (onConflict.action.kind === 'do-nothing') {
    return new InsertOnConflict(columns, new DoNothingConflictAction());
  }

  return new InsertOnConflict(
    columns,
    new DoUpdateSetConflictAction(rewriteUpdateSet(onConflict.action.set, rewriter)),
  );
}

abstract class AstNode {
  abstract readonly kind: string;

  protected freeze(): void {
    Object.freeze(this);
  }
}

abstract class QueryAst extends AstNode {
  abstract collectParamRefs(): AnyParamRef[];
  abstract toQueryAst(): AnyQueryAst;
}

abstract class FromSource extends AstNode {
  abstract rewrite(rewriter: AstRewriter): AnyFromSource;
  abstract toFromSource(): AnyFromSource;
}

abstract class Expression extends AstNode implements ExpressionSource {
  abstract accept<R>(visitor: ExprVisitor<R>): R;
  abstract rewrite(rewriter: ExpressionRewriter): AnyExpression;
  abstract fold<T>(folder: ExpressionFolder<T>): T;

  collectColumnRefs(): ColumnRef[] {
    return collectColumnRefsWith(this);
  }

  collectParamRefs(): AnyParamRef[] {
    return collectParamRefsWith(this);
  }

  baseColumnRef(): ColumnRef {
    throw new InternalError(`${this.constructor.name} does not expose a base column reference`);
  }

  #asAnyExpression(): AnyExpression {
    return this.accept(toAnyExpressionVisitor);
  }

  toExpr(): AnyExpression {
    return this.#asAnyExpression();
  }

  not(): NotExpr {
    return new NotExpr(this.#asAnyExpression());
  }
}

export class TableSource extends FromSource {
  readonly kind = 'table-source' as const;
  readonly name: string;
  readonly alias: string | undefined;
  /**
   * Resolved storage namespace coordinate for this table, stamped when the
   * table proxy constructs the AST. Renderers qualify via the namespace
   * concretion's `qualifyTable()` using this id — never by re-resolving the
   * bare table name at render time.
   */
  readonly namespaceId: string | undefined;

  protected constructor(name: string, alias?: string, namespaceId?: string) {
    super();
    this.name = name;
    this.alias = alias;
    this.namespaceId = namespaceId;
  }

  static named(name: string, alias?: string, namespaceId?: string): TableSource {
    const source = new TableSource(name, alias, namespaceId);
    source.freeze();
    return source;
  }

  override rewrite(rewriter: AstRewriter): AnyFromSource {
    return rewriter.tableSource ? rewriter.tableSource(this) : this;
  }

  override toFromSource(): AnyFromSource {
    return this;
  }
}

export interface TableRef {
  readonly name: string;
  readonly alias?: string;
}

export class DerivedTableSource extends FromSource {
  readonly kind = 'derived-table-source' as const;
  readonly alias: string;
  readonly query: SelectAst;

  constructor(alias: string, query: SelectAst) {
    super();
    this.alias = alias;
    this.query = query;
    this.freeze();
  }

  static as(alias: string, query: SelectAst): DerivedTableSource {
    return new DerivedTableSource(alias, query);
  }

  // Intentionally does not call rewriter.tableSource — derived tables are rewritten via their inner query, not intercepted at the FromSource level. A future fromSource?(source: AnyFromSource) callback would be needed for that.
  override rewrite(rewriter: AstRewriter): AnyFromSource {
    return new DerivedTableSource(this.alias, this.query.rewrite(rewriter));
  }

  override toFromSource(): AnyFromSource {
    return this;
  }
}

export interface FunctionSourceAlias {
  readonly alias: string;
  readonly columnAliases?: ReadonlyArray<string>;
}

export class FunctionSource extends FromSource {
  readonly kind = 'function-source' as const;
  readonly fn: string;
  readonly args: ReadonlyArray<AnyExpression>;
  readonly alias: string | undefined;
  readonly columnAliases: ReadonlyArray<string> | undefined;
  readonly ordinality: boolean;

  protected constructor(
    fn: string,
    args: ReadonlyArray<AnyExpression>,
    alias?: FunctionSourceAlias,
    ordinality = false,
  ) {
    super();
    if (alias?.columnAliases?.length === 0) {
      throw structuredError(
        'RUNTIME.AST_INVALID',
        'FunctionSource column aliases must not be empty',
        {
          meta: { kind: 'function-source', field: 'columnAliases' },
        },
      );
    }
    this.fn = fn;
    this.args = frozenArrayCopy(args);
    this.alias = alias?.alias;
    this.columnAliases =
      alias?.columnAliases === undefined ? undefined : frozenArrayCopy(alias.columnAliases);
    this.ordinality = ordinality;
    this.freeze();
  }

  static of(
    fn: string,
    args: ReadonlyArray<AnyExpression>,
    alias?: FunctionSourceAlias,
  ): FunctionSource {
    return new FunctionSource(fn, args, alias);
  }

  #aliasOptions(): FunctionSourceAlias | undefined {
    if (this.alias === undefined) return undefined;
    return {
      alias: this.alias,
      ...ifDefined('columnAliases', this.columnAliases),
    };
  }

  withOrdinality(): FunctionSource {
    if (this.ordinality) return this;
    return new FunctionSource(this.fn, this.args, this.#aliasOptions(), true);
  }

  override rewrite(rewriter: AstRewriter): AnyFromSource {
    const rewrittenArgs = this.args.map((arg) => rewriteComparable(arg, rewriter));
    if (rewrittenArgs.every((arg, i) => arg === this.args[i])) return this;
    return new FunctionSource(this.fn, rewrittenArgs, this.#aliasOptions(), this.ordinality);
  }

  override toFromSource(): AnyFromSource {
    return this;
  }
}

export class ColumnRef extends Expression {
  readonly kind = 'column-ref' as const;
  readonly table: string;
  readonly column: string;

  constructor(table: string, column: string) {
    super();
    this.table = table;
    this.column = column;
    this.freeze();
  }

  static of(table: string, column: string): ColumnRef {
    return new ColumnRef(table, column);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.columnRef(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.columnRef ? rewriter.columnRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.columnRef ? folder.columnRef(this) : folder.empty;
  }

  override baseColumnRef(): ColumnRef {
    return this;
  }
}

export class IdentifierRef extends Expression {
  readonly kind = 'identifier-ref' as const;
  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
    this.freeze();
  }

  static of(name: string): IdentifierRef {
    return new IdentifierRef(name);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.identifierRef(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.identifierRef ? rewriter.identifierRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.identifierRef ? folder.identifierRef(this) : folder.empty;
  }
}

export class ParamRef extends Expression {
  readonly kind = 'param-ref' as const;
  readonly value: unknown;
  readonly name: string | undefined;
  /**
   * Codec identity carried by every column-bound `ParamRef`. The encode-side dispatch path materialises the per-instance codec through `contractCodecs.forCodecRef(codec)` — content-keyed memoisation on `(codecId, canonicalize(typeParams))` keeps repeated lookups for the same logical column on one shared {@link Codec}.
   *
   * `codec` may be `undefined` for `ParamRef`s constructed without a column-bound site (literals, transient builder state); the runtime treats those as untyped passthroughs.
   */
  readonly codec: CodecRef | undefined;

  constructor(
    value: unknown,
    options?: {
      name?: string;
      codec?: CodecRef;
    },
  ) {
    super();
    this.value = value;
    this.name = options?.name;
    this.codec = options?.codec ? frozenCodecRef(options.codec) : undefined;
    this.freeze();
  }

  static of(
    value: unknown,
    options?: {
      name?: string;
      codec?: CodecRef;
    },
  ): ParamRef {
    return new ParamRef(value, options);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.param(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.paramRef ? rewriter.paramRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.paramRef ? folder.paramRef(this) : folder.empty;
  }
}

/**
 * Bind-site placeholder: occupies the same positions as `ParamRef` in the
 * AST, but carries no value — the value is supplied per-execute by the
 * `statement.query(target, params)` caller and matched to this node by
 * `name`.
 */
export class PreparedParamRef extends Expression {
  readonly kind = 'prepared-param-ref' as const;
  readonly name: string;
  readonly codec: CodecRef;

  constructor(name: string, codec: CodecRef) {
    super();
    this.name = name;
    this.codec = frozenCodecRef(codec);
    this.freeze();
  }

  static of(name: string, codec: CodecRef): PreparedParamRef {
    return new PreparedParamRef(name, codec);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.preparedParam(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.preparedParamRef ? rewriter.preparedParamRef(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.preparedParamRef ? folder.preparedParamRef(this) : folder.empty;
  }
}

export class DefaultValueExpr extends AstNode {
  readonly kind = 'default-value' as const;

  constructor() {
    super();
    this.freeze();
  }
}

export class LiteralExpr extends Expression {
  readonly kind = 'literal' as const;
  readonly value: unknown;

  constructor(value: unknown) {
    super();
    this.value = value;
    this.freeze();
  }

  static of(value: unknown): LiteralExpr {
    return new LiteralExpr(value);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.literal(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.literal ? rewriter.literal(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.literal ? folder.literal(this) : folder.empty;
  }
}

export class SubqueryExpr extends Expression {
  readonly kind = 'subquery' as const;
  readonly query: SelectAst;

  constructor(query: SelectAst) {
    super();
    this.query = query;
    this.freeze();
  }

  static of(query: SelectAst): SubqueryExpr {
    return new SubqueryExpr(query);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.subquery(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    const query = this.query.rewrite(rewriter);
    return new SubqueryExpr(query);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.select ? folder.select(this.query) : folder.empty;
  }
}

export class OperationExpr extends Expression {
  readonly kind = 'operation' as const;
  readonly method: string;
  readonly self: AnyExpression;
  readonly args: ReadonlyArray<AnyExpression | ParamRef | LiteralExpr>;
  readonly returns: ParamSpec;
  readonly lowering: SqlLoweringSpec;

  constructor(options: {
    readonly method: string;
    readonly self: AnyExpression;
    readonly args: ReadonlyArray<AnyExpression | ParamRef | LiteralExpr> | undefined;
    readonly returns: ParamSpec;
    readonly lowering: SqlLoweringSpec;
  }) {
    super();
    this.method = options.method;
    this.self = options.self;
    this.args = frozenArrayCopy(options.args ?? []);
    this.returns = options.returns;
    this.lowering = options.lowering;
    this.freeze();
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.operation(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new OperationExpr({
      method: this.method,
      self: this.self.rewrite(rewriter),
      args: this.args.map((arg) => rewriteComparable(arg, rewriter)),
      returns: this.returns,
      lowering: this.lowering,
    });
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      () => this.self.fold(folder),
      ...this.args.map((arg) => () => foldComparable(arg, folder)),
    ]);
  }

  override baseColumnRef(): ColumnRef {
    return this.self.baseColumnRef();
  }
}

export class RawExpr extends Expression {
  readonly kind = 'raw-expr' as const;
  readonly parts: ReadonlyArray<string | AnyExpression>;
  readonly returns: ParamSpec;

  constructor(options: {
    readonly parts: ReadonlyArray<string | AnyExpression>;
    readonly returns: ParamSpec;
  }) {
    super();
    this.parts = frozenArrayCopy(options.parts);
    this.returns = options.returns;
    this.freeze();
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.rawExpr(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return rewriter.rawExpr ? rewriter.rawExpr(this) : this;
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    if (folder.rawExpr) {
      return folder.rawExpr(this);
    }
    return combineAll(
      folder,
      this.parts
        .filter((p): p is AnyExpression => typeof p !== 'string')
        .map((p) => () => p.fold(folder)),
    );
  }
}

export class AggregateExpr extends Expression {
  readonly kind = 'aggregate' as const;
  readonly fn: AggregateFn;
  readonly expr: AnyExpression | undefined;

  constructor(fn: AggregateFn, expr?: AnyExpression) {
    super();
    if (fn !== 'count' && expr === undefined) {
      throw structuredError(
        'ORM.ARGUMENT_INVALID',
        `Aggregate function "${fn}" requires an expression`,
        { meta: { fn } },
      );
    }
    this.fn = fn;
    this.expr = expr;
    this.freeze();
  }

  static count(expr?: AnyExpression): AggregateExpr {
    return new AggregateExpr('count', expr);
  }

  static sum(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('sum', expr);
  }

  static avg(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('avg', expr);
  }

  static min(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('min', expr);
  }

  static max(expr: AnyExpression): AggregateExpr {
    return new AggregateExpr('max', expr);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.aggregate(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return this.expr === undefined ? this : new AggregateExpr(this.fn, this.expr.rewrite(rewriter));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr ? this.expr.fold(folder) : folder.empty;
  }
}

/**
 * Window function call: `fn(args) OVER (PARTITION BY ... ORDER BY ...)`.
 *
 * Both `partitionBy` and `orderBy` are optional; an empty `OVER ()`
 * clause is legal SQL but rarely useful. For `ROW_NUMBER`, `RANK`, and
 * `DENSE_RANK` the standard mandates an `ORDER BY` for deterministic
 * results — callers are expected to provide one, but the AST does not
 * enforce it.
 *
 * The `args` slot exists for future window function additions that take
 * arguments (e.g. `COUNT(*) OVER`, `SUM(x) OVER`); `ROW_NUMBER` and the
 * other ranking functions take no arguments.
 */
export class WindowFuncExpr extends Expression {
  readonly kind = 'window-func' as const;
  readonly fn: WindowFn;
  readonly args: ReadonlyArray<AnyExpression>;
  readonly partitionBy: ReadonlyArray<AnyExpression> | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;

  constructor(options: {
    readonly fn: WindowFn;
    readonly args?: ReadonlyArray<AnyExpression>;
    readonly partitionBy?: ReadonlyArray<AnyExpression>;
    readonly orderBy?: ReadonlyArray<OrderByItem>;
  }) {
    super();
    this.fn = options.fn;
    this.args = options.args && options.args.length > 0 ? frozenArrayCopy(options.args) : [];
    this.partitionBy =
      options.partitionBy && options.partitionBy.length > 0
        ? frozenArrayCopy(options.partitionBy)
        : undefined;
    this.orderBy =
      options.orderBy && options.orderBy.length > 0 ? frozenArrayCopy(options.orderBy) : undefined;
    this.freeze();
  }

  static rowNumber(options: {
    readonly partitionBy?: ReadonlyArray<AnyExpression>;
    readonly orderBy?: ReadonlyArray<OrderByItem>;
  }): WindowFuncExpr {
    return new WindowFuncExpr({ fn: 'row_number', ...options });
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.windowFunc(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new WindowFuncExpr({
      fn: this.fn,
      args: this.args.map((arg) => arg.rewrite(rewriter)),
      ...ifDefined(
        'partitionBy',
        this.partitionBy?.map((expr) => expr.rewrite(rewriter)),
      ),
      ...ifDefined(
        'orderBy',
        this.orderBy?.map((orderItem) => orderItem.rewrite(rewriter)),
      ),
    });
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      ...this.args.map((arg) => () => arg.fold(folder)),
      ...(this.partitionBy ?? []).map((expr) => () => expr.fold(folder)),
      ...(this.orderBy ?? []).map((orderItem) => () => orderItem.expr.fold(folder)),
    ]);
  }
}

export class FunctionCallExpr extends Expression {
  readonly kind = 'function-call' as const;
  readonly fn: string;
  readonly args: ReadonlyArray<AnyExpression>;

  constructor(fn: string, args: ReadonlyArray<AnyExpression>) {
    super();
    this.fn = fn;
    this.args = frozenArrayCopy(args);
    this.freeze();
  }

  static of(fn: string, args: ReadonlyArray<AnyExpression>): FunctionCallExpr {
    return new FunctionCallExpr(fn, args);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.functionCall(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new FunctionCallExpr(
      this.fn,
      this.args.map((arg) => arg.rewrite(rewriter)),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.args.map((arg) => () => arg.fold(folder)),
    );
  }
}

export class CastExpr extends Expression {
  readonly kind = 'cast' as const;
  readonly expr: AnyExpression;
  readonly targetType: string;

  constructor(expr: AnyExpression, targetType: string) {
    super();
    this.expr = expr;
    this.targetType = targetType;
    this.freeze();
  }

  static as(expr: AnyExpression, targetType: string): CastExpr {
    return new CastExpr(expr, targetType);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.cast(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new CastExpr(this.expr.rewrite(rewriter), this.targetType);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr.fold(folder);
  }
}

export interface CaseBranch {
  readonly condition: AnyExpression;
  readonly value: AnyExpression;
}

export class CaseExpr extends Expression {
  readonly kind = 'case' as const;
  readonly branches: ReadonlyArray<Readonly<CaseBranch>>;
  readonly elseExpr: AnyExpression | undefined;

  constructor(branches: ReadonlyArray<CaseBranch>, elseExpr?: AnyExpression) {
    super();
    if (branches.length === 0) {
      throw structuredError('RUNTIME.AST_INVALID', 'CaseExpr requires at least one branch', {
        meta: { kind: 'case', field: 'branches' },
      });
    }
    this.branches = Object.freeze(
      branches.map((branch) =>
        Object.freeze({
          condition: branch.condition,
          value: branch.value,
        }),
      ),
    );
    this.elseExpr = elseExpr;
    this.freeze();
  }

  static of(branches: ReadonlyArray<CaseBranch>, elseExpr?: AnyExpression): CaseExpr {
    return new CaseExpr(branches, elseExpr);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.case(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new CaseExpr(
      this.branches.map((branch) => ({
        condition: branch.condition.rewrite(rewriter),
        value: branch.value.rewrite(rewriter),
      })),
      this.elseExpr?.rewrite(rewriter),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    const elseExpr = this.elseExpr;
    return combineAll(folder, [
      ...this.branches.flatMap((branch) => [
        () => branch.condition.fold(folder),
        () => branch.value.fold(folder),
      ]),
      ...(elseExpr === undefined ? [] : [() => elseExpr.fold(folder)]),
    ]);
  }
}

export class JsonObjectExpr extends Expression {
  readonly kind = 'json-object' as const;
  readonly entries: ReadonlyArray<JsonObjectEntry>;

  constructor(entries: ReadonlyArray<JsonObjectEntry>) {
    super();
    this.entries = frozenArrayCopy(entries.map((entry) => Object.freeze({ ...entry })));
    this.freeze();
  }

  static entry(key: string, value: AnyJsonValueProjection): JsonObjectEntry {
    return {
      key,
      value,
    };
  }

  static fromEntries(entries: ReadonlyArray<JsonObjectEntry>): JsonObjectExpr {
    return new JsonObjectExpr(entries);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.jsonObject(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new JsonObjectExpr(
      this.entries.map((entry) => ({
        key: entry.key,
        value: entry.value.rewrite(rewriter),
      })),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.entries.map((entry) => () => entry.value.fold(folder)),
    );
  }
}

export class OrderByItem extends AstNode {
  readonly kind = 'order-by-item' as const;
  readonly expr: AnyExpression;
  readonly dir: Direction;
  readonly nulls: NullsPlacement | undefined;

  constructor(expr: AnyExpression, dir: Direction, nulls?: NullsPlacement) {
    super();
    this.expr = expr;
    this.dir = dir;
    this.nulls = nulls;
    this.freeze();
  }

  static asc(expr: AnyExpression, nulls?: NullsPlacement): OrderByItem {
    return new OrderByItem(expr, 'asc', nulls);
  }

  static desc(expr: AnyExpression, nulls?: NullsPlacement): OrderByItem {
    return new OrderByItem(expr, 'desc', nulls);
  }

  rewrite(rewriter: ExpressionRewriter): OrderByItem {
    return new OrderByItem(this.expr.rewrite(rewriter), this.dir, this.nulls);
  }

  /**
   * A new frozen item with the sort order inverted and `expr` unchanged.
   * Integrations that own pagination (e.g. backward cursor pagination) use
   * this to reverse a user's sort order without reaching into the AST.
   *
   * An explicit NULL placement flips with the direction: inverting a total
   * order has to move NULLs to the opposite end, or reversing a page would
   * not read back as the mirror of the forward page. An absent placement
   * stays absent, since each target's default already flips with `dir`.
   */
  reverse(): OrderByItem {
    const dir = this.dir === 'asc' ? 'desc' : 'asc';
    if (this.nulls === undefined) return new OrderByItem(this.expr, dir);
    return new OrderByItem(this.expr, dir, this.nulls === 'first' ? 'last' : 'first');
  }
}

export class JsonArrayAggExpr extends Expression {
  readonly kind = 'json-array-agg' as const;
  readonly expr: AnyJsonValueProjection;
  readonly onEmpty: 'null' | 'emptyArray';
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;

  constructor(
    expr: AnyJsonValueProjection,
    onEmpty: 'null' | 'emptyArray' = 'null',
    orderBy?: ReadonlyArray<OrderByItem>,
  ) {
    super();
    this.expr = expr;
    this.onEmpty = onEmpty;
    this.orderBy = orderBy && orderBy.length > 0 ? frozenArrayCopy(orderBy) : undefined;
    this.freeze();
  }

  static of(
    expr: AnyJsonValueProjection,
    onEmpty: 'null' | 'emptyArray' = 'null',
    orderBy?: ReadonlyArray<OrderByItem>,
  ): JsonArrayAggExpr {
    return new JsonArrayAggExpr(expr, onEmpty, orderBy);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.jsonArrayAgg(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new JsonArrayAggExpr(
      this.expr.rewrite(rewriter),
      this.onEmpty,
      this.orderBy?.map((orderItem) => orderItem.rewrite(rewriter)),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      () => this.expr.fold(folder),
      ...(this.orderBy ?? []).map((orderItem) => () => orderItem.expr.fold(folder)),
    ]);
  }
}

export class ListExpression extends Expression {
  readonly kind = 'list' as const;
  readonly values: ReadonlyArray<AnyExpression>;

  constructor(values: ReadonlyArray<AnyExpression>) {
    super();
    this.values = frozenArrayCopy(values);
    this.freeze();
  }

  static of(values: ReadonlyArray<AnyExpression>): ListExpression {
    return new ListExpression(values);
  }

  static fromValues(values: ReadonlyArray<unknown>): ListExpression {
    return new ListExpression(values.map((value) => new LiteralExpr(value)));
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.list(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    if (rewriter.list) {
      return rewriter.list(this);
    }

    return new ListExpression(this.values.map((value) => value.rewrite(rewriter)));
  }

  fold<T>(folder: ExpressionFolder<T>): T {
    if (folder.list) {
      return folder.list(this);
    }
    return combineAll(
      folder,
      this.values.map((value) => () => value.fold(folder)),
    );
  }
}

export class BinaryExpr extends Expression {
  readonly kind = 'binary' as const;
  readonly op: BinaryOp;
  readonly left: AnyExpression;
  readonly right: AnyExpression;

  constructor(op: BinaryOp, left: AnyExpression, right: AnyExpression) {
    super();
    this.op = op;
    this.left = left;
    this.right = right;
    this.freeze();
  }

  static eq(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('eq', left, right);
  }

  static neq(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('neq', left, right);
  }

  static gt(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('gt', left, right);
  }

  static lt(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('lt', left, right);
  }

  static gte(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('gte', left, right);
  }

  static lte(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('lte', left, right);
  }

  static like(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('like', left, right);
  }

  static in(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('in', left, right);
  }

  static notIn(left: AnyExpression, right: AnyExpression): BinaryExpr {
    return new BinaryExpr('notIn', left, right);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.binary(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new BinaryExpr(
      this.op,
      rewriteComparable(this.left, rewriter),
      rewriteComparable(this.right, rewriter),
    );
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(folder, [
      () => foldComparable(this.left, folder),
      () => foldComparable(this.right, folder),
    ]);
  }
}

export class AndExpr extends Expression {
  readonly kind = 'and' as const;
  readonly exprs: ReadonlyArray<AnyExpression>;

  constructor(exprs: ReadonlyArray<AnyExpression>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<AnyExpression>): AndExpr {
    return new AndExpr(exprs);
  }

  static true(): AndExpr {
    return new AndExpr([]);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.and(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new AndExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }
}

export class OrExpr extends Expression {
  readonly kind = 'or' as const;
  readonly exprs: ReadonlyArray<AnyExpression>;

  constructor(exprs: ReadonlyArray<AnyExpression>) {
    super();
    this.exprs = frozenArrayCopy(exprs);
    this.freeze();
  }

  static of(exprs: ReadonlyArray<AnyExpression>): OrExpr {
    return new OrExpr(exprs);
  }

  static false(): OrExpr {
    return new OrExpr([]);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.or(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new OrExpr(this.exprs.map((expr) => expr.rewrite(rewriter)));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return combineAll(
      folder,
      this.exprs.map((expr) => () => expr.fold(folder)),
    );
  }
}

export class ExistsExpr extends Expression {
  readonly kind = 'exists' as const;
  readonly notExists: boolean;
  readonly subquery: SelectAst;

  constructor(subquery: SelectAst, notExists = false) {
    super();
    this.notExists = notExists;
    this.subquery = subquery;
    this.freeze();
  }

  static exists(subquery: SelectAst): ExistsExpr {
    return new ExistsExpr(subquery, false);
  }

  static notExists(subquery: SelectAst): ExistsExpr {
    return new ExistsExpr(subquery, true);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.exists(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new ExistsExpr(this.subquery.rewrite(rewriter), this.notExists);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return folder.select ? folder.select(this.subquery) : folder.empty;
  }
}

export class NullCheckExpr extends Expression {
  readonly kind = 'null-check' as const;
  readonly expr: AnyExpression;
  readonly isNull: boolean;

  constructor(expr: AnyExpression, isNull: boolean) {
    super();
    this.expr = expr;
    this.isNull = isNull;
    this.freeze();
  }

  static isNull(expr: AnyExpression): NullCheckExpr {
    return new NullCheckExpr(expr, true);
  }

  static isNotNull(expr: AnyExpression): NullCheckExpr {
    return new NullCheckExpr(expr, false);
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.nullCheck(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new NullCheckExpr(this.expr.rewrite(rewriter), this.isNull);
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr.fold(folder);
  }
}

export class NotExpr extends Expression {
  readonly kind = 'not' as const;
  readonly expr: AnyExpression;

  constructor(expr: AnyExpression) {
    super();
    this.expr = expr;
    this.freeze();
  }

  toWhereExpr(): AnyExpression {
    return this;
  }

  override accept<R>(visitor: ExprVisitor<R>): R {
    return visitor.not(this);
  }

  override rewrite(rewriter: ExpressionRewriter): AnyExpression {
    return new NotExpr(this.expr.rewrite(rewriter));
  }

  override fold<T>(folder: ExpressionFolder<T>): T {
    return this.expr.fold(folder);
  }
}

export class EqColJoinOn extends AstNode {
  readonly kind = 'eq-col-join-on' as const;
  readonly left: ColumnRef;
  readonly right: ColumnRef;

  constructor(left: ColumnRef, right: ColumnRef) {
    super();
    this.left = left;
    this.right = right;
    this.freeze();
  }

  static of(left: ColumnRef, right: ColumnRef): EqColJoinOn {
    return new EqColJoinOn(left, right);
  }

  rewrite(rewriter: AstRewriter): EqColJoinOn | AnyExpression {
    return rewriter.eqColJoinOn ? rewriter.eqColJoinOn(this) : this;
  }
}

export class JoinAst extends AstNode {
  readonly kind = 'join' as const;
  readonly joinType: 'inner' | 'left' | 'right' | 'full';
  readonly source: AnyFromSource;
  readonly lateral: boolean;
  readonly on: JoinOnExpr;

  constructor(
    joinType: 'inner' | 'left' | 'right' | 'full',
    source: AnyFromSource,
    on: JoinOnExpr,
    lateral = false,
  ) {
    super();
    this.joinType = joinType;
    this.source = source;
    this.lateral = lateral;
    this.on = on;
    this.freeze();
  }

  static inner(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('inner', source, on, lateral);
  }

  static left(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('left', source, on, lateral);
  }

  static right(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('right', source, on, lateral);
  }

  static full(source: AnyFromSource, on: JoinOnExpr, lateral = false): JoinAst {
    return new JoinAst('full', source, on, lateral);
  }

  rewrite(rewriter: AstRewriter): JoinAst {
    return new JoinAst(
      this.joinType,
      this.source.rewrite(rewriter),
      this.on.kind === 'eq-col-join-on' ? this.on.rewrite(rewriter) : this.on.rewrite(rewriter),
      this.lateral,
    );
  }
}

export class ProjectionItem extends AstNode {
  readonly kind = 'projection-item' as const;
  readonly alias: string;
  readonly expr: ProjectionExpr;
  /**
   * Codec identity for any known projected result, whether read directly from a contract column or forwarded through a query wrapper. Decode-side dispatch resolves the per-instance codec through `contractCodecs.forCodecRef(codec)` — content-keyed memoisation collapses repeated lookups for the same logical result onto one shared {@link Codec}.
   *
   * Stays `undefined` only when the projected result's codec is unknown, such as computed expressions, subqueries, or raw aliases whose decoded type the runtime cannot infer.
   */
  readonly codec: CodecRef | undefined;

  constructor(alias: string, expr: ProjectionExpr, codec?: CodecRef) {
    super();
    this.alias = alias;
    this.expr = expr;
    this.codec = codec ? frozenCodecRef(codec) : undefined;
    this.freeze();
  }

  static of(alias: string, expr: ProjectionExpr, codec?: CodecRef): ProjectionItem {
    return new ProjectionItem(alias, expr, codec);
  }

  withCodec(codec: CodecRef | undefined): ProjectionItem {
    return new ProjectionItem(this.alias, this.expr, codec);
  }
}

export type LimitOffsetValue = number | AnyExpression;

export interface SelectAstOptions {
  readonly from?: AnyFromSource;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: AnyExpression | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<AnyExpression> | undefined;
  readonly groupBy: ReadonlyArray<AnyExpression> | undefined;
  readonly having: AnyExpression | undefined;
  readonly limit: LimitOffsetValue | undefined;
  readonly offset: LimitOffsetValue | undefined;
  readonly selectAllIntent: { readonly table?: string } | undefined;
}

export class SelectAst extends QueryAst {
  readonly kind = 'select' as const;
  readonly from: AnyFromSource | undefined;
  readonly joins: ReadonlyArray<JoinAst> | undefined;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly where: AnyExpression | undefined;
  readonly orderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: ReadonlyArray<AnyExpression> | undefined;
  readonly groupBy: ReadonlyArray<AnyExpression> | undefined;
  readonly having: AnyExpression | undefined;
  readonly limit: LimitOffsetValue | undefined;
  readonly offset: LimitOffsetValue | undefined;
  readonly selectAllIntent: { readonly table?: string } | undefined;

  constructor(options: SelectAstOptions) {
    super();
    this.from = options.from;
    this.joins =
      options.joins && options.joins.length > 0 ? frozenArrayCopy(options.joins) : undefined;
    this.projection = frozenArrayCopy(options.projection);
    this.where = options.where;
    this.orderBy =
      options.orderBy && options.orderBy.length > 0 ? frozenArrayCopy(options.orderBy) : undefined;
    this.distinct = options.distinct;
    this.distinctOn =
      options.distinctOn && options.distinctOn.length > 0
        ? frozenArrayCopy(options.distinctOn)
        : undefined;
    this.groupBy =
      options.groupBy && options.groupBy.length > 0 ? frozenArrayCopy(options.groupBy) : undefined;
    this.having = options.having;
    this.limit = options.limit;
    this.offset = options.offset;
    this.selectAllIntent = frozenOptionalRecordCopy(options.selectAllIntent);
    this.freeze();
  }

  static from(from: AnyFromSource): SelectAst {
    return new SelectAst({
      from,
      joins: undefined,
      projection: [],
      where: undefined,
      orderBy: undefined,
      distinct: undefined,
      distinctOn: undefined,
      groupBy: undefined,
      having: undefined,
      limit: undefined,
      offset: undefined,
      selectAllIntent: undefined,
    });
  }

  static noFrom(): SelectAst {
    return new SelectAst({
      joins: undefined,
      projection: [],
      where: undefined,
      orderBy: undefined,
      distinct: undefined,
      distinctOn: undefined,
      groupBy: undefined,
      having: undefined,
      limit: undefined,
      offset: undefined,
      selectAllIntent: undefined,
    });
  }

  private toOptions(): SelectAstOptions {
    return {
      ...(this.from !== undefined ? { from: this.from } : {}),
      joins: this.joins,
      projection: this.projection,
      where: this.where,
      orderBy: this.orderBy,
      distinct: this.distinct,
      distinctOn: this.distinctOn,
      groupBy: this.groupBy,
      having: this.having,
      limit: this.limit,
      offset: this.offset,
      selectAllIntent: this.selectAllIntent,
    };
  }

  withFrom(from: AnyFromSource): SelectAst {
    return new SelectAst({ ...this.toOptions(), from });
  }

  withJoins(joins: ReadonlyArray<JoinAst>): SelectAst {
    return new SelectAst({
      ...this.toOptions(),
      joins: joins.length > 0 ? joins : undefined,
    });
  }

  withProjection(projection: ReadonlyArray<ProjectionItem>): SelectAst {
    return new SelectAst({ ...this.toOptions(), projection });
  }

  addProjection(alias: string, expr: ProjectionExpr): SelectAst {
    return new SelectAst({
      ...this.toOptions(),
      projection: [...this.projection, new ProjectionItem(alias, expr)],
    });
  }

  withWhere(where: AnyExpression | undefined): SelectAst {
    return new SelectAst({ ...this.toOptions(), where });
  }

  withOrderBy(orderBy: ReadonlyArray<OrderByItem>): SelectAst {
    return new SelectAst({
      ...this.toOptions(),
      orderBy: orderBy.length > 0 ? orderBy : undefined,
    });
  }

  withDistinct(enabled = true): SelectAst {
    return new SelectAst({
      ...this.toOptions(),
      distinct: enabled ? true : undefined,
    });
  }

  withDistinctOn(distinctOn: ReadonlyArray<AnyExpression>): SelectAst {
    return new SelectAst({
      ...this.toOptions(),
      distinctOn: distinctOn.length > 0 ? distinctOn : undefined,
    });
  }

  withGroupBy(groupBy: ReadonlyArray<AnyExpression>): SelectAst {
    return new SelectAst({
      ...this.toOptions(),
      groupBy: groupBy.length > 0 ? groupBy : undefined,
    });
  }

  withHaving(having: AnyExpression | undefined): SelectAst {
    return new SelectAst({ ...this.toOptions(), having });
  }

  withLimit(limit: LimitOffsetValue | undefined): SelectAst {
    return new SelectAst({ ...this.toOptions(), limit });
  }

  withOffset(offset: LimitOffsetValue | undefined): SelectAst {
    return new SelectAst({ ...this.toOptions(), offset });
  }

  withSelectAllIntent(selectAllIntent: { readonly table?: string } | undefined): SelectAst {
    return new SelectAst({ ...this.toOptions(), selectAllIntent });
  }

  rewrite(rewriter: AstRewriter): SelectAst {
    const rewrittenFrom = this.from?.rewrite(rewriter);
    const rewritten = new SelectAst({
      ...(rewrittenFrom !== undefined ? { from: rewrittenFrom } : {}),
      joins: this.joins?.map((join) => join.rewrite(rewriter)),
      projection: this.projection.map(
        (projection) =>
          new ProjectionItem(
            projection.alias,
            projection.expr.kind === 'literal'
              ? rewriter.literal
                ? rewriter.literal(projection.expr)
                : projection.expr
              : projection.expr.rewrite(rewriter),
            projection.codec,
          ),
      ),
      where: this.where?.rewrite(rewriter),
      orderBy: this.orderBy?.map((orderItem) => orderItem.rewrite(rewriter)),
      distinct: this.distinct,
      distinctOn: this.distinctOn?.map((expr) => expr.rewrite(rewriter)),
      groupBy: this.groupBy?.map((expr) => expr.rewrite(rewriter)),
      having: this.having?.rewrite(rewriter),
      limit: rewriteLimitOffset(this.limit, rewriter),
      offset: rewriteLimitOffset(this.offset, rewriter),
      selectAllIntent: this.selectAllIntent,
    });

    return rewriter.select ? rewriter.select(rewritten) : rewritten;
  }

  collectColumnRefs(): ColumnRef[] {
    const refs: ColumnRef[] = [];
    const pushRefs = (columns: ReadonlyArray<ColumnRef>) => {
      refs.push(...columns);
    };

    if (this.from?.kind === 'derived-table-source') {
      pushRefs(this.from.query.collectColumnRefs());
    } else if (this.from?.kind === 'function-source') {
      for (const arg of this.from.args) {
        pushRefs(arg.collectColumnRefs());
      }
    }

    for (const projection of this.projection) {
      if (!(projection.expr.kind === 'literal')) {
        pushRefs(projection.expr.collectColumnRefs());
      }
    }

    if (this.where) {
      pushRefs(this.where.collectColumnRefs());
    }
    if (this.having) {
      pushRefs(this.having.collectColumnRefs());
    }
    for (const orderItem of this.orderBy ?? []) {
      pushRefs(orderItem.expr.collectColumnRefs());
    }
    for (const expr of this.distinctOn ?? []) {
      pushRefs(expr.collectColumnRefs());
    }
    for (const expr of this.groupBy ?? []) {
      pushRefs(expr.collectColumnRefs());
    }
    for (const join of this.joins ?? []) {
      if (join.source.kind === 'derived-table-source') {
        pushRefs(join.source.query.collectColumnRefs());
      } else if (join.source.kind === 'function-source') {
        for (const arg of join.source.args) {
          pushRefs(arg.collectColumnRefs());
        }
      }
      if (join.on.kind === 'eq-col-join-on') {
        refs.push(join.on.left, join.on.right);
      } else {
        pushRefs(join.on.collectColumnRefs());
      }
    }
    if (typeof this.limit === 'object') {
      pushRefs(this.limit.collectColumnRefs());
    }
    if (typeof this.offset === 'object') {
      pushRefs(this.offset.collectColumnRefs());
    }

    return refs;
  }

  collectParamRefs(): AnyParamRef[] {
    const refs: AnyParamRef[] = [];
    const pushRefs = (params: ReadonlyArray<AnyParamRef>) => {
      refs.push(...params);
    };

    if (this.from?.kind === 'derived-table-source') {
      pushRefs(this.from.query.collectParamRefs());
    } else if (this.from?.kind === 'function-source') {
      for (const arg of this.from.args) {
        pushRefs(arg.collectParamRefs());
      }
    }

    for (const projection of this.projection) {
      if (!(projection.expr.kind === 'literal')) {
        pushRefs(projection.expr.collectParamRefs());
      }
    }

    if (this.where) {
      pushRefs(this.where.collectParamRefs());
    }
    if (this.having) {
      pushRefs(this.having.collectParamRefs());
    }
    for (const orderItem of this.orderBy ?? []) {
      pushRefs(orderItem.expr.collectParamRefs());
    }
    for (const expr of this.distinctOn ?? []) {
      pushRefs(expr.collectParamRefs());
    }
    for (const expr of this.groupBy ?? []) {
      pushRefs(expr.collectParamRefs());
    }
    for (const join of this.joins ?? []) {
      if (join.source.kind === 'derived-table-source') {
        pushRefs(join.source.query.collectParamRefs());
      } else if (join.source.kind === 'function-source') {
        for (const arg of join.source.args) {
          pushRefs(arg.collectParamRefs());
        }
      }
      if (!(join.on.kind === 'eq-col-join-on')) {
        pushRefs(join.on.collectParamRefs());
      }
    }
    if (typeof this.limit === 'object') {
      pushRefs(this.limit.collectParamRefs());
    }
    if (typeof this.offset === 'object') {
      pushRefs(this.offset.collectParamRefs());
    }

    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

abstract class InsertOnConflictAction extends AstNode {
  abstract toInsertOnConflictAction(): AnyInsertOnConflictAction;
}

export class DoNothingConflictAction extends InsertOnConflictAction {
  readonly kind = 'do-nothing' as const;

  constructor() {
    super();
    this.freeze();
  }

  override toInsertOnConflictAction(): AnyInsertOnConflictAction {
    return this;
  }
}

export class DoUpdateSetConflictAction extends InsertOnConflictAction {
  readonly kind = 'do-update-set' as const;
  readonly set: Readonly<Record<string, AnyExpression>>;

  constructor(set: Readonly<Record<string, AnyExpression>>) {
    super();
    this.set = frozenRecordCopy(set);
    this.freeze();
  }

  override toInsertOnConflictAction(): AnyInsertOnConflictAction {
    return this;
  }
}

export class InsertOnConflict extends AstNode {
  readonly kind = 'insert-on-conflict' as const;
  readonly columns: ReadonlyArray<ColumnRef>;
  readonly action: AnyInsertOnConflictAction;

  constructor(columns: ReadonlyArray<ColumnRef>, action: AnyInsertOnConflictAction) {
    super();
    this.columns = frozenArrayCopy(columns);
    this.action = action;
    this.freeze();
  }

  static on(columns: ReadonlyArray<ColumnRef>): InsertOnConflict {
    return new InsertOnConflict(columns, new DoNothingConflictAction());
  }

  doNothing(): InsertOnConflict {
    return new InsertOnConflict(this.columns, new DoNothingConflictAction());
  }

  doUpdateSet(set: Readonly<Record<string, AnyExpression>>): InsertOnConflict {
    return new InsertOnConflict(this.columns, new DoUpdateSetConflictAction(set));
  }
}

export class InsertAst extends QueryAst {
  readonly kind = 'insert' as const;
  readonly table: TableSource;
  readonly rows: ReadonlyArray<Readonly<Record<string, InsertValue>>>;
  readonly onConflict: InsertOnConflict | undefined;
  readonly returning: ReadonlyArray<ProjectionItem> | undefined;

  constructor(
    table: TableSource,
    rows: ReadonlyArray<Record<string, InsertValue>> = [{}],
    onConflict?: InsertOnConflict,
    returning?: ReadonlyArray<ProjectionItem>,
  ) {
    super();
    this.table = table;
    this.rows = freezeRows(rows);
    this.onConflict = onConflict;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static into(table: TableSource): InsertAst {
    return new InsertAst(table);
  }

  withRows(rows: ReadonlyArray<Record<string, InsertValue>>): InsertAst {
    return new InsertAst(
      this.table,
      rows.map((row) => ({ ...row })),
      this.onConflict,
      this.returning,
    );
  }

  withReturning(returning: ReadonlyArray<ProjectionItem> | undefined): InsertAst {
    return new InsertAst(
      this.table,
      this.rows.map((row) => ({ ...row })),
      this.onConflict,
      returning,
    );
  }

  withOnConflict(onConflict: InsertOnConflict | undefined): InsertAst {
    return new InsertAst(
      this.table,
      this.rows.map((row) => ({ ...row })),
      onConflict,
      this.returning,
    );
  }

  rewrite(rewriter: AstRewriter): InsertAst {
    return new InsertAst(
      rewriteTableSource(this.table, rewriter),
      this.rows.map((row) => rewriteInsertRow(row, rewriter)),
      this.onConflict ? rewriteOnConflict(this.onConflict, rewriter) : undefined,
      this.returning?.map((item) => rewriteProjectionItem(item, rewriter)),
    );
  }

  override collectParamRefs(): AnyParamRef[] {
    const refs: AnyParamRef[] = [];
    for (const row of this.rows) {
      for (const value of Object.values(row)) {
        if (value.kind === 'param-ref' || value.kind === 'prepared-param-ref') {
          refs.push(value);
        } else if (value.kind === 'raw-expr') {
          refs.push(...value.collectParamRefs());
        }
      }
    }
    if (this.onConflict?.action.kind === 'do-update-set') {
      for (const value of Object.values(this.onConflict.action.set)) {
        if (value.kind === 'param-ref' || value.kind === 'prepared-param-ref') {
          refs.push(value);
        }
      }
    }
    for (const item of this.returning ?? []) {
      if (item.expr.kind !== 'literal') {
        refs.push(...item.expr.collectParamRefs());
      }
    }
    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export class UpdateAst extends QueryAst {
  readonly kind = 'update' as const;
  readonly table: TableSource;
  readonly set: Readonly<Record<string, AnyExpression>>;
  readonly where: AnyExpression | undefined;
  readonly returning: ReadonlyArray<ProjectionItem> | undefined;

  constructor(
    table: TableSource,
    set: Readonly<Record<string, AnyExpression>> = {},
    where?: AnyExpression,
    returning?: ReadonlyArray<ProjectionItem>,
  ) {
    super();
    this.table = table;
    this.set = frozenRecordCopy(set);
    this.where = where;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static table(table: TableSource): UpdateAst {
    return new UpdateAst(table);
  }

  withSet(set: Readonly<Record<string, AnyExpression>>): UpdateAst {
    return new UpdateAst(this.table, set, this.where, this.returning);
  }

  withWhere(where: AnyExpression | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ProjectionItem> | undefined): UpdateAst {
    return new UpdateAst(this.table, this.set, this.where, returning);
  }

  rewrite(rewriter: AstRewriter): UpdateAst {
    return new UpdateAst(
      rewriteTableSource(this.table, rewriter),
      rewriteUpdateSet(this.set, rewriter),
      this.where?.rewrite(rewriter),
      this.returning?.map((item) => rewriteProjectionItem(item, rewriter)),
    );
  }

  override collectParamRefs(): AnyParamRef[] {
    const refs: AnyParamRef[] = [];
    for (const value of Object.values(this.set)) {
      refs.push(...value.collectParamRefs());
    }
    if (this.where) {
      refs.push(...this.where.collectParamRefs());
    }
    for (const item of this.returning ?? []) {
      if (item.expr.kind !== 'literal') {
        refs.push(...item.expr.collectParamRefs());
      }
    }
    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export class DeleteAst extends QueryAst {
  readonly kind = 'delete' as const;
  readonly table: TableSource;
  readonly where: AnyExpression | undefined;
  readonly returning: ReadonlyArray<ProjectionItem> | undefined;

  constructor(
    table: TableSource,
    where?: AnyExpression,
    returning?: ReadonlyArray<ProjectionItem>,
  ) {
    super();
    this.table = table;
    this.where = where;
    this.returning = returning && returning.length > 0 ? frozenArrayCopy(returning) : undefined;
    this.freeze();
  }

  static from(table: TableSource): DeleteAst {
    return new DeleteAst(table);
  }

  withWhere(where: AnyExpression | undefined): DeleteAst {
    return new DeleteAst(this.table, where, this.returning);
  }

  withReturning(returning: ReadonlyArray<ProjectionItem> | undefined): DeleteAst {
    return new DeleteAst(this.table, this.where, returning);
  }

  rewrite(rewriter: AstRewriter): DeleteAst {
    return new DeleteAst(
      rewriteTableSource(this.table, rewriter),
      this.where?.rewrite(rewriter),
      this.returning?.map((item) => rewriteProjectionItem(item, rewriter)),
    );
  }

  override collectParamRefs(): AnyParamRef[] {
    const refs: AnyParamRef[] = [];
    if (this.where) {
      refs.push(...this.where.collectParamRefs());
    }
    for (const item of this.returning ?? []) {
      if (item.expr.kind !== 'literal') {
        refs.push(...item.expr.collectParamRefs());
      }
    }
    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

/**
 * One column of a raw query's declared result row: the codec that decodes the
 * column and whether it may carry `null`. Structurally identical to the
 * contract-free lane's `ColumnDescriptor`, so a spec written for one reads as
 * a spec for the other.
 */
export interface RawQueryColumn {
  readonly codecId: string;
  readonly nullable: boolean;
}

/**
 * What a raw statement yields: rows decoded against a declared column set, or
 * the number of rows the statement affected.
 */
export type RawQueryResult =
  | { readonly kind: 'rows'; readonly columns: Readonly<Record<string, RawQueryColumn>> }
  | { readonly kind: 'affected-count' };

/**
 * The one column name a declared result cannot carry. Writing `__proto__` onto
 * an object literal sets that object's prototype instead of adding a property,
 * so a column so named would disappear between the declaration and the decoded
 * row — and the row type would still promise it. Every other name that shadows
 * something on `Object.prototype` (`constructor`, `prototype`) is an ordinary
 * own property when assigned, and passes through as declared.
 */
const RESERVED_RESULT_COLUMN = '__proto__';

function frozenRawQueryResult(result: RawQueryResult): RawQueryResult {
  if (result.kind === 'affected-count') {
    return Object.freeze({ kind: 'affected-count' as const });
  }
  const columns: Record<string, RawQueryColumn> = {};
  for (const [name, column] of Object.entries(result.columns)) {
    if (name === RESERVED_RESULT_COLUMN) {
      throw structuredError(
        'RUNTIME.AST_INVALID',
        `A raw query result cannot declare a "${RESERVED_RESULT_COLUMN}" column: alias the column in SQL and declare the alias instead`,
        { meta: { kind: 'raw-query', field: 'result.columns', column: name } },
      );
    }
    columns[name] = Object.freeze({ codecId: column.codecId, nullable: column.nullable });
  }
  return Object.freeze({ kind: 'rows' as const, columns: Object.freeze(columns) });
}

/**
 * Raw-SQL statement AST node: a whole query authored as a template, carrying
 * the same `parts` representation as {@link RawExpr} (literal SQL fragments
 * interleaved with interpolated expressions and `ParamRef`s) plus the result
 * the author declared for it.
 *
 * The shared `parts` shape is what lets a row-returning raw query be spliced
 * into another raw template: the inner parts are concatenated into the outer
 * list, so parameters keep their template order and lowering walks one flat
 * sequence.
 */
export class RawQueryAst extends QueryAst {
  readonly kind = 'raw-query' as const;
  readonly parts: ReadonlyArray<string | AnyExpression>;
  readonly result: RawQueryResult;

  constructor(options: {
    readonly parts: ReadonlyArray<string | AnyExpression>;
    readonly result: RawQueryResult;
  }) {
    super();
    this.parts = frozenArrayCopy(options.parts);
    this.result = frozenRawQueryResult(options.result);
    this.freeze();
  }

  static rows(
    parts: ReadonlyArray<string | AnyExpression>,
    columns: Readonly<Record<string, RawQueryColumn>>,
  ): RawQueryAst {
    return new RawQueryAst({ parts, result: { kind: 'rows', columns } });
  }

  static affectedCount(parts: ReadonlyArray<string | AnyExpression>): RawQueryAst {
    return new RawQueryAst({ parts, result: { kind: 'affected-count' } });
  }

  rewrite(rewriter: AstRewriter): RawQueryAst {
    return new RawQueryAst({
      parts: this.parts.map((part) =>
        typeof part === 'string' ? part : rewriteComparable(part, rewriter),
      ),
      result: this.result,
    });
  }

  override collectParamRefs(): AnyParamRef[] {
    const refs: AnyParamRef[] = [];
    for (const part of this.parts) {
      if (typeof part !== 'string') {
        refs.push(...part.collectParamRefs());
      }
    }
    return refs;
  }

  override toQueryAst(): AnyQueryAst {
    return this;
  }
}

export type AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst | RawQueryAst;
export type AnyFromSource = TableSource | DerivedTableSource | FunctionSource;
export type AnyExpression =
  | ColumnRef
  | IdentifierRef
  | ParamRef
  | PreparedParamRef
  | LiteralExpr
  | SubqueryExpr
  | OperationExpr
  | AggregateExpr
  | WindowFuncExpr
  | FunctionCallExpr
  | CastExpr
  | CaseExpr
  | JsonObjectExpr
  | JsonArrayAggExpr
  | ListExpression
  | BinaryExpr
  | AndExpr
  | OrExpr
  | ExistsExpr
  | NullCheckExpr
  | NotExpr
  | RawExpr;
export type AnyParamRef = ParamRef | PreparedParamRef;
export type AnyInsertOnConflictAction = DoNothingConflictAction | DoUpdateSetConflictAction;
export type AnyInsertValue = ColumnRef | ParamRef | PreparedParamRef | DefaultValueExpr | RawExpr;
export type AnyOperationArg = AnyExpression | ParamRef | PreparedParamRef | LiteralExpr;

export const queryAstKinds: ReadonlySet<string> = new Set<AnyQueryAst['kind']>([
  'select',
  'insert',
  'update',
  'delete',
  'raw-query',
]);
export const whereExprKinds: ReadonlySet<string> = new Set<AnyExpression['kind']>([
  'binary',
  'and',
  'or',
  'exists',
  'null-check',
  'not',
]);

export function isQueryAst(value: unknown): value is AnyQueryAst {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    queryAstKinds.has(value.kind)
  );
}

export function isWhereExpr(value: unknown): value is AnyExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    whereExprKinds.has(value.kind)
  );
}

export interface ToWhereExpr {
  toWhereExpr(): AnyExpression;
}

/**
 * One positional slot of a lowered SQL statement.
 *
 * - `literal` — a value baked into the AST; passes through to the driver.
 * - `bind` — a `PreparedParamRef` placeholder; the runtime resolves the
 *   value from the per-execute `userParams[name]` before calling the driver.
 *
 * The same `name` may legitimately appear in multiple `bind` slots when a
 * renderer does not dedupe `PreparedParamRef` occurrences (e.g. SQLite's
 * positional `?` walker calls `ast.collectParamRefs()` directly rather than
 * `collectOrderedParamRefs`); resolution-by-name handles that case
 * correctly. See `collectOrderedParamRefs` in `./util` for the dedupe
 * contract used by Postgres' `$N` renderer.
 */
export type LoweredParam =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'bind'; readonly name: string };

export interface LoweredStatement {
  readonly sql: string;
  readonly params: readonly LoweredParam[];
  readonly annotations?: Record<string, unknown>;
}

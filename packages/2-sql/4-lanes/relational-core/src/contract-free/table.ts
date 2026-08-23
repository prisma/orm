import type { ParamSpec } from '@internal/operations';
import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  type AnyFromSource,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  IdentifierRef,
  InsertAst,
  InsertOnConflict,
  type InsertValue,
  JoinAst,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  type OrderByNulls,
  OrExpr,
  ParamRef,
  ProjectionItem,
  RawExpr,
  SelectAst,
  TableSource,
  UpdateAst,
} from '../ast/types';

export interface ColumnDescriptor {
  readonly codecId: string;
  readonly nullable: boolean;
}

export type ColumnSchema = Record<string, ColumnDescriptor>;

/**
 * A composable WHERE / ON expression. Wraps an `AnyExpression` and exposes
 * fluent boolean combinators, mirroring the spirit of `sql-builder`'s
 * `Expression` interface without the contract-bound type machinery.
 */
export class CfExpr {
  constructor(readonly ast: AnyExpression) {}

  and(other: CfExpr): CfExpr {
    return new CfExpr(AndExpr.of([this.ast, other.ast]));
  }

  or(other: CfExpr): CfExpr {
    return new CfExpr(OrExpr.of([this.ast, other.ast]));
  }

  not(): CfExpr {
    return new CfExpr(this.ast.not());
  }

  isNull(): CfExpr {
    return new CfExpr(NullCheckExpr.isNull(this.ast));
  }

  isNotNull(): CfExpr {
    return new CfExpr(NullCheckExpr.isNotNull(this.ast));
  }

  eqLit(value: number | string | boolean): CfExpr {
    return new CfExpr(BinaryExpr.eq(this.ast, LiteralExpr.of(value)));
  }

  gtLit(value: number | string | boolean): CfExpr {
    return new CfExpr(BinaryExpr.gt(this.ast, LiteralExpr.of(value)));
  }

  eqParam(value: unknown, codecId: string): CfExpr {
    return new CfExpr(BinaryExpr.eq(this.ast, ParamRef.of(value, { codec: { codecId } })));
  }

  eqExpr(other: CfExpr): CfExpr {
    return new CfExpr(BinaryExpr.eq(this.ast, other.ast));
  }
}

export interface CfFnOptions {
  readonly method: string;
  readonly template: string;
  readonly self: CfExpr;
  readonly args?: ReadonlyArray<CfExpr>;
  readonly returns: ParamSpec;
}

export const cfExpr = {
  countStar(): CfExpr {
    return new CfExpr(AggregateExpr.count());
  },
  lit(value: number | string | boolean): CfExpr {
    return new CfExpr(LiteralExpr.of(value));
  },
  identifierRef(name: string): CfExpr {
    return new CfExpr(IdentifierRef.of(name));
  },
  param(value: unknown, codecId: string): CfExpr {
    return new CfExpr(ParamRef.of(value, { codec: { codecId } }));
  },
  /**
   * Catalog function call lowered via a `'function'`-strategy template
   * (e.g. `to_regclass({{self}})`). Owns the `OperationExpr` assembly so
   * target packages only supply vocabulary: template, codec'd operands,
   * and return spec.
   */
  fn(options: CfFnOptions): CfExpr {
    return new CfExpr(
      new OperationExpr({
        method: options.method,
        self: options.self.ast,
        args: options.args?.map((arg) => arg.ast),
        returns: options.returns,
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: options.template,
        },
      }),
    );
  },
  columnRef(qualifier: string, name: string): CfExpr {
    return new CfExpr(ColumnRef.of(qualifier, name));
  },
  allOf(exprs: ReadonlyArray<CfExpr>): CfExpr {
    return new CfExpr(AndExpr.of(exprs.map((expr) => expr.ast)));
  },
  /**
   * Opaque DB-side SQL expression (e.g. `current_schema()`) carried as a
   * `RawExpr`. For zero-operand catalog functions where a `'function'`
   * lowering template has nothing to substitute.
   */
  raw(sql: string, returns: ParamSpec): CfExpr {
    return new CfExpr(new RawExpr({ parts: [sql], returns }));
  },
  exists(query: CfExprSelectQuery): CfExpr {
    return new CfExpr(ExistsExpr.exists(query.build()));
  },
  notExists(query: CfExprSelectQuery): CfExpr {
    return new CfExpr(ExistsExpr.notExists(query.build()));
  },
};

/** Aliased table source for catalog queries (no namespace coordinate). */
export function cfTable(name: string, alias?: string): TableSource {
  return TableSource.named(name, alias);
}

export class CfExprSelectQuery {
  constructor(
    private readonly src: AnyFromSource | undefined,
    private readonly projectionItems: ReadonlyArray<ProjectionItem>,
    private readonly whereExpr: CfExpr | undefined,
    private readonly joinItems: ReadonlyArray<JoinAst> = [],
    private readonly limitValue: number | undefined = undefined,
  ) {}

  from(source: AnyFromSource): CfExprSelectQuery {
    return new CfExprSelectQuery(
      source,
      this.projectionItems,
      this.whereExpr,
      this.joinItems,
      this.limitValue,
    );
  }

  join(source: AnyFromSource, on: CfExpr): CfExprSelectQuery {
    return new CfExprSelectQuery(
      this.src,
      this.projectionItems,
      this.whereExpr,
      [...this.joinItems, JoinAst.inner(source, on.ast)],
      this.limitValue,
    );
  }

  leftJoin(source: AnyFromSource, on: CfExpr): CfExprSelectQuery {
    return new CfExprSelectQuery(
      this.src,
      this.projectionItems,
      this.whereExpr,
      [...this.joinItems, JoinAst.left(source, on.ast)],
      this.limitValue,
    );
  }

  project(alias: string, expr: CfExpr): CfExprSelectQuery {
    return new CfExprSelectQuery(
      this.src,
      [...this.projectionItems, ProjectionItem.of(alias, expr.ast)],
      this.whereExpr,
      this.joinItems,
      this.limitValue,
    );
  }

  where(expr: CfExpr): CfExprSelectQuery {
    return new CfExprSelectQuery(
      this.src,
      this.projectionItems,
      expr,
      this.joinItems,
      this.limitValue,
    );
  }

  limit(value: number): CfExprSelectQuery {
    return new CfExprSelectQuery(
      this.src,
      this.projectionItems,
      this.whereExpr,
      this.joinItems,
      value,
    );
  }

  build(): SelectAst {
    if (this.joinItems.length > 0 && this.src === undefined) {
      throw structuredError(
        'ORM.ARGUMENT_INVALID',
        'CfExprSelectQuery: cannot add a JOIN without a FROM clause',
      );
    }
    const base =
      this.src !== undefined
        ? SelectAst.from(this.src).withProjection(this.projectionItems)
        : SelectAst.noFrom().withProjection(this.projectionItems);
    const withJoins = this.joinItems.length > 0 ? base.withJoins(this.joinItems) : base;
    const withWhere =
      this.whereExpr !== undefined ? withJoins.withWhere(this.whereExpr.ast) : withJoins;
    return this.limitValue !== undefined ? withWhere.withLimit(this.limitValue) : withWhere;
  }
}

export function exprSelect(): CfExprSelectQuery {
  return new CfExprSelectQuery(undefined, [], undefined);
}

/**
 * Per-column authoring handle exposed as a keyed property on a {@link TableHandle}.
 * Carries codec metadata baked at declaration time so no codec ID, table name, or
 * column name needs to be repeated at the call site.
 */
export interface ColumnProxy {
  readonly codecId: string;
  readonly nullable: boolean;
  readonly columnName: string;
  readonly tableName: string;
  eq(value: unknown): CfExpr;
  neq(value: unknown): CfExpr;
  isNull(): CfExpr;
  isNotNull(): CfExpr;
  toRef(): ColumnRef;
  toProjectionItem(alias?: string): ProjectionItem;
}

/**
 * Object passed to the {@link CfConflictClause.doUpdate} callback. Each key
 * resolves to a `ColumnRef` for the corresponding `excluded.<column>`, so the
 * upsert conflict-update branch can copy proposed values without re-binding
 * parameters.
 */
export type ExcludedProxy<Schema extends ColumnSchema> = {
  readonly [K in keyof Schema]: ColumnRef;
};

export type TableInsertRow<Schema extends ColumnSchema> = {
  readonly [K in keyof Schema]: unknown;
};

export type TableSetValues<Schema extends ColumnSchema> = {
  readonly [K in keyof Schema]?: unknown;
};

/**
 * Fluent authoring handle for a fixed control-plane table. Column proxies are
 * exposed as keyed properties so `handle.columnName.eq(value)` composes without
 * threading codec IDs, table names, or column refs at the call site.
 */
export type TableHandle<Schema extends ColumnSchema> = {
  readonly source: TableSource;
  insert(row: TableInsertRow<Schema>): CfInsertQuery<Schema>;
  upsert(row: TableInsertRow<Schema>): CfUpsertBuilder<Schema>;
  update(): CfUpdateQuery<Schema>;
  select(...columns: ReadonlyArray<ColumnProxy>): CfSelectQuery;
} & {
  readonly [K in keyof Schema]: ColumnProxy;
};

export class CfInsertQuery<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
    private readonly returningItems: ReadonlyArray<ProjectionItem> | undefined = undefined,
  ) {}

  returning(...columns: ReadonlyArray<ColumnProxy>): CfInsertQuery<Schema> {
    return new CfInsertQuery(
      this.src,
      this.schema,
      this.rowValues,
      columns.map((col) => col.toProjectionItem()),
    );
  }

  build(): InsertAst {
    const row = buildInsertRow(this.schema, this.rowValues);
    const ast = InsertAst.into(this.src).withRows([row]);
    return this.returningItems ? ast.withReturning(this.returningItems) : ast;
  }
}

export class CfUpsertBuilder<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
  ) {}

  onConflict(...columns: ReadonlyArray<ColumnProxy>): CfConflictClause<Schema> {
    return new CfConflictClause(this.src, this.schema, this.rowValues, [...columns]);
  }
}

export class CfConflictClause<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
    private readonly conflictCols: ReadonlyArray<ColumnProxy>,
  ) {}

  doUpdate(
    setOrCallback:
      | TableSetValues<Schema>
      | ((excluded: ExcludedProxy<Schema>) => TableSetValues<Schema>),
  ): CfUpsertQuery<Schema> {
    const set =
      typeof setOrCallback === 'function'
        ? setOrCallback(buildExcludedProxy(this.schema))
        : setOrCallback;
    return new CfUpsertQuery(this.src, this.schema, this.rowValues, this.conflictCols, set);
  }

  doNothing(): CfUpsertQuery<Schema> {
    return new CfUpsertQuery(this.src, this.schema, this.rowValues, this.conflictCols, undefined);
  }
}

export class CfUpsertQuery<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly rowValues: TableInsertRow<Schema>,
    private readonly conflictCols: ReadonlyArray<ColumnProxy>,
    private readonly updateSet: TableSetValues<Schema> | undefined,
  ) {}

  build(): InsertAst {
    const row = buildInsertRow(this.schema, this.rowValues);
    const conflictRefs = this.conflictCols.map((col) => col.toRef());
    const onConflict =
      this.updateSet === undefined
        ? InsertOnConflict.on(conflictRefs).doNothing()
        : InsertOnConflict.on(conflictRefs).doUpdateSet(buildSetMap(this.schema, this.updateSet));
    return InsertAst.into(this.src).withRows([row]).withOnConflict(onConflict);
  }
}

export class CfUpdateQuery<Schema extends ColumnSchema> {
  constructor(
    private readonly src: TableSource,
    private readonly schema: Schema,
    private readonly setValues: TableSetValues<Schema> | undefined = undefined,
    private readonly whereExpr: CfExpr | undefined = undefined,
    private readonly returningItems: ReadonlyArray<ProjectionItem> | undefined = undefined,
  ) {}

  set(values: TableSetValues<Schema>): CfUpdateQuery<Schema> {
    return new CfUpdateQuery(this.src, this.schema, values, this.whereExpr, this.returningItems);
  }

  where(expr: CfExpr): CfUpdateQuery<Schema> {
    return new CfUpdateQuery(this.src, this.schema, this.setValues, expr, this.returningItems);
  }

  returning(...columns: ReadonlyArray<ColumnProxy>): CfUpdateQuery<Schema> {
    return new CfUpdateQuery(
      this.src,
      this.schema,
      this.setValues,
      this.whereExpr,
      columns.map((col) => col.toProjectionItem()),
    );
  }

  build(): UpdateAst {
    const set = buildSetMap(this.schema, this.setValues);
    const base = UpdateAst.table(this.src).withSet(set);
    const withWhere = this.whereExpr ? base.withWhere(this.whereExpr.ast) : base;
    return this.returningItems ? withWhere.withReturning(this.returningItems) : withWhere;
  }
}

export class CfSelectQuery {
  constructor(
    private readonly src: TableSource,
    private readonly projectionItems: ReadonlyArray<ProjectionItem>,
    private readonly whereExpr: CfExpr | undefined = undefined,
    private readonly orderByItems: ReadonlyArray<OrderByItem> = [],
  ) {}

  where(expr: CfExpr): CfSelectQuery {
    return new CfSelectQuery(this.src, this.projectionItems, expr, this.orderByItems);
  }

  orderBy(column: ColumnProxy, dir: 'asc' | 'desc' = 'asc', nulls?: OrderByNulls): CfSelectQuery {
    const item = new OrderByItem(column.toRef(), dir, nulls);
    return new CfSelectQuery(this.src, this.projectionItems, this.whereExpr, [
      ...this.orderByItems,
      item,
    ]);
  }

  build(): SelectAst {
    const base = SelectAst.from(this.src).withProjection(this.projectionItems);
    const withWhere = this.whereExpr ? base.withWhere(this.whereExpr.ast) : base;
    return this.orderByItems.length > 0 ? withWhere.withOrderBy(this.orderByItems) : withWhere;
  }
}

/**
 * Declare a control-plane table once, binding column codecs at declaration time.
 * Returns a `TableHandle` whose column properties compose expressions directly
 * without per-call-site codec or column-name threading.
 *
 * ```ts
 * const marker = pgTable({ name: 'marker', schema: 'prisma_contract' }, {
 *   space:      text(),
 *   core_hash:  text(),
 *   updated_at: timestamptz(),
 * });
 *
 * const query = marker.update()
 *   .set({ core_hash: newHash, updated_at: NOW })
 *   .where(marker.space.eq(space).and(marker.core_hash.eq(expectedFrom)))
 *   .returning(marker.space)
 *   .build();
 * ```
 */
export function table<Schema extends ColumnSchema>(
  source: TableSource,
  schema: Schema,
): TableHandle<Schema> {
  const proxies: Record<string, ColumnProxy> = {};
  for (const [col, desc] of Object.entries(schema)) {
    proxies[col] = makeColumnProxy(source.alias ?? source.name, col, desc);
  }

  const handle = {
    ...proxies,
    source,
    insert: (row: TableInsertRow<Schema>) => new CfInsertQuery(source, schema, row),
    upsert: (row: TableInsertRow<Schema>) => new CfUpsertBuilder(source, schema, row),
    update: () => new CfUpdateQuery(source, schema),
    select: (...cols: ReadonlyArray<ColumnProxy>) =>
      new CfSelectQuery(
        source,
        cols.map((col) => col.toProjectionItem()),
      ),
  };

  return blindCast<
    TableHandle<Schema>,
    'Column proxies are dynamically built from Schema keys — TypeScript cannot verify the per-key ColumnProxy constraint at the spread call site. Construction is correct by construction: every key maps to makeColumnProxy(source.name, key, schema[key]).'
  >(handle);
}

function makeColumnProxy(
  tableName: string,
  columnName: string,
  desc: ColumnDescriptor,
): ColumnProxy {
  const ref = ColumnRef.of(tableName, columnName);
  return {
    codecId: desc.codecId,
    nullable: desc.nullable,
    columnName,
    tableName,
    eq: (value) =>
      value === null
        ? new CfExpr(NullCheckExpr.isNull(ref))
        : new CfExpr(BinaryExpr.eq(ref, toSetExpression(value, desc))),
    neq: (value) =>
      value === null
        ? new CfExpr(NullCheckExpr.isNotNull(ref))
        : new CfExpr(BinaryExpr.neq(ref, toSetExpression(value, desc))),
    isNull: () => new CfExpr(NullCheckExpr.isNull(ref)),
    isNotNull: () => new CfExpr(NullCheckExpr.isNotNull(ref)),
    toRef: () => ref,
    toProjectionItem: (alias = columnName) =>
      ProjectionItem.of(alias, ref, { codecId: desc.codecId }),
  };
}

function buildExcludedProxy<Schema extends ColumnSchema>(schema: Schema): ExcludedProxy<Schema> {
  return blindCast<
    ExcludedProxy<Schema>,
    'Object.fromEntries cannot preserve per-key ColumnRef types — correct by construction: every key maps to ColumnRef.of("excluded", key).'
  >(Object.fromEntries(Object.keys(schema).map((col) => [col, ColumnRef.of('excluded', col)])));
}

function isExpressionSource(value: unknown): value is { toExpr(): AnyExpression } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toExpr' in value &&
    typeof value.toExpr === 'function'
  );
}

function toInsertValue(value: unknown, desc: ColumnDescriptor): InsertValue {
  if (isExpressionSource(value)) {
    const expr = value.toExpr();
    if (
      expr.kind === 'column-ref' ||
      expr.kind === 'param-ref' ||
      expr.kind === 'prepared-param-ref' ||
      expr.kind === 'raw-expr'
    ) {
      return expr;
    }
  }
  return ParamRef.of(value, { codec: { codecId: desc.codecId } });
}

function toSetExpression(value: unknown, desc: ColumnDescriptor): AnyExpression {
  if (isExpressionSource(value)) {
    return value.toExpr();
  }
  return ParamRef.of(value, { codec: { codecId: desc.codecId } });
}

function buildInsertRow<Schema extends ColumnSchema>(
  schema: Schema,
  values: TableInsertRow<Schema>,
): Record<string, InsertValue> {
  const row: Record<string, InsertValue> = {};
  const rawValues = blindCast<
    Record<string, unknown>,
    'TableInsertRow<Schema> maps Schema keys to unknown; indexing by the same string keys is correct by construction'
  >(values);
  for (const [col, desc] of Object.entries(schema)) {
    row[col] = toInsertValue(rawValues[col], desc);
  }
  return row;
}

function buildSetMap<Schema extends ColumnSchema>(
  schema: Schema,
  values: TableSetValues<Schema> | undefined,
): Record<string, AnyExpression> {
  if (values === undefined) return {};
  const set: Record<string, AnyExpression> = {};
  const rawSchema = blindCast<
    Record<string, ColumnDescriptor>,
    'Schema extends ColumnSchema = Record<string, ColumnDescriptor>; runtime key access is correct by construction'
  >(schema);
  const rawValues = blindCast<
    Record<string, unknown>,
    'TableSetValues<Schema> maps Schema keys to unknown; iterating with Object.entries is correct by construction'
  >(values);
  for (const [col, value] of Object.entries(rawValues)) {
    const desc = rawSchema[col];
    if (desc !== undefined) {
      set[col] = toSetExpression(value, desc);
    }
  }
  return set;
}

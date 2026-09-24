import type {
  AnnotationValue,
  MutationDefaultsOp,
  OperationKind,
  ValidAnnotations,
} from '@internal/framework-components/runtime';
import { assertAnnotationsApplicable } from '@internal/framework-components/runtime';
import type { StorageTable } from '@internal/sql-contract/types';
import {
  type AnyExpression as AstExpression,
  ColumnRef,
  DeleteAst,
  InsertAst,
  ParamRef,
  ProjectionItem,
  type TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import type { Expression, ExpressionBuilder } from '../expression';
import type { ResolveRow } from '../resolve';
import type { QueryContext, Scope, ScopeField } from '../scope';
import type {
  DeleteQuery,
  InsertQuery,
  ReturningCapability,
  UpdateQuery,
} from '../types/mutation-query';
import {
  BuilderBase,
  type BuilderContext,
  buildQueryPlan,
  codecRefFor,
  combineWhereExprs,
} from './builder-base';
import { createFieldProxy } from './field-proxy';
import { createFunctions } from './functions';

/**
 * Validates and merges a variadic annotations call into a builder's
 * accumulated user-annotations map. Used by `.annotate(...)` on each of
 * the three mutation builders (`InsertQueryImpl`, `UpdateQueryImpl`,
 * `DeleteQueryImpl`); the read builders share the same logic via
 * `QueryBase.annotate()` in `./query-impl.ts`.
 *
 * Runs `assertAnnotationsApplicable` at call time (not at `.build()`) so
 * inapplicable annotations forced through casts surface immediately
 * rather than at plan-construction time.
 */
function mergeWriteAnnotations(
  current: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>,
  annotations: readonly AnnotationValue<unknown, OperationKind>[],
): ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> {
  assertAnnotationsApplicable(annotations, 'write', 'sql-dsl.annotate');
  const next = new Map(current);
  for (const annotation of annotations) {
    next.set(annotation.namespace, annotation);
  }
  return next;
}

type WhereCallback = ExpressionBuilder<Scope, QueryContext>;
export type UpdateSetCallback = (
  fields: ReturnType<typeof createFieldProxy>,
  fns: ReturnType<typeof createFunctions>,
) => Record<string, Expression<ScopeField> | undefined>;

export function buildParamValues(
  values: Record<string, unknown>,
  namespaceId: string,
  table: StorageTable,
  tableName: string,
  op: MutationDefaultsOp,
  ctx: BuilderContext,
): Record<string, ParamRef> {
  const params: Record<string, ParamRef> = {};
  for (const [col, value] of Object.entries(values)) {
    const column = table.columns[col];
    const codec = column ? codecRefFor(ctx, namespaceId, tableName, col) : undefined;
    params[col] = ParamRef.of(value, codec ? { codec } : undefined);
  }
  for (const def of ctx.applyMutationDefaults({
    op,
    namespace: namespaceId,
    entry: tableName,
    values,
  })) {
    const column = table.columns[def.field];
    const codec = column ? codecRefFor(ctx, namespaceId, tableName, def.field) : undefined;
    params[def.field] = ParamRef.of(def.value, codec ? { codec } : undefined);
  }
  return params;
}

function buildReturningProjections(
  tableName: string,
  columns: string[],
  rowFields: Record<string, ScopeField>,
): ProjectionItem[] {
  return columns.map((col) =>
    ProjectionItem.of(col, ColumnRef.of(tableName, col), rowFields[col]?.codec),
  );
}

function evaluateWhere(
  whereCallback: WhereCallback,
  scope: Scope,
  queryOperationTypes: BuilderContext['queryOperationTypes'],
  rawCodecInferer: BuilderContext['rawCodecInferer'],
): AstExpression {
  const fieldProxy = createFieldProxy(scope);
  const fns = createFunctions(queryOperationTypes, rawCodecInferer);
  const result = whereCallback(fieldProxy, fns as never);
  return result.buildAst();
}

export function evaluateUpdateCallback(
  callback: UpdateSetCallback,
  scope: Scope,
  queryOperationTypes: BuilderContext['queryOperationTypes'],
  rawCodecInferer: BuilderContext['rawCodecInferer'],
): Record<string, AstExpression> {
  const fieldProxy = createFieldProxy(scope);
  const fns = createFunctions(queryOperationTypes, rawCodecInferer);
  const result = callback(fieldProxy, fns as never);
  const set: Record<string, AstExpression> = {};
  for (const [col, expr] of Object.entries(result)) {
    if (expr !== undefined) {
      set[col] = expr.buildAst();
    }
  }
  return set;
}

export function buildSetExpressions(
  exprs: Record<string, AstExpression>,
  namespaceId: string,
  table: StorageTable,
  tableName: string,
  op: MutationDefaultsOp,
  ctx: BuilderContext,
): Record<string, AstExpression> {
  const set: Record<string, AstExpression> = { ...exprs };
  for (const def of ctx.applyMutationDefaults({
    op,
    namespace: namespaceId,
    entry: tableName,
    values: exprs,
  })) {
    if (!(def.field in set)) {
      const column = table.columns[def.field];
      const codec = column ? codecRefFor(ctx, namespaceId, tableName, def.field) : undefined;
      set[def.field] = ParamRef.of(def.value, ifDefined('codec', codec));
    }
  }
  return set;
}

export class InsertQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends BuilderBase<QC['capabilities']>
  implements InsertQuery<QC, AvailableScope, RowType>
{
  readonly #tableSource: TableSource;
  readonly #tableName: string;
  readonly #namespaceId: string;
  readonly #table: StorageTable;
  readonly #scope: Scope;
  readonly #rows: ReadonlyArray<Record<string, unknown>>;
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;
  readonly #annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;

  constructor(
    tableSource: TableSource,
    namespaceId: string,
    table: StorageTable,
    scope: Scope,
    rows: ReadonlyArray<Record<string, unknown>>,
    ctx: BuilderContext,
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
    annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> = new Map(),
  ) {
    super(ctx);
    this.#tableSource = tableSource;
    this.#tableName = tableSource.name;
    this.#namespaceId = namespaceId;
    this.#table = table;
    this.#scope = scope;
    this.#rows = rows;
    this.#returningColumns = returningColumns;
    this.#rowFields = rowFields;
    this.#annotations = annotations;
  }

  returning = this._gate<ReturningCapability, string[], InsertQuery<QC, AvailableScope, never>>(
    { sql: { returning: true } },
    'returning',
    (...columns: string[]) => {
      const newRowFields: Record<string, ScopeField> = {};
      for (const col of columns) {
        const field = this.#scope.topLevel[col];
        if (!field)
          throw structuredError('ORM.COLUMN_UNKNOWN', `Column "${col}" not found in scope`, {
            meta: { column: col },
          });
        newRowFields[col] = field;
      }
      return new InsertQueryImpl(
        this.#tableSource,
        this.#namespaceId,
        this.#table,
        this.#scope,
        this.#rows,
        this.ctx,
        columns,
        newRowFields,
        this.#annotations,
      ) as unknown as InsertQuery<QC, AvailableScope, never>;
    },
  );

  /**
   * Attach one or more write-typed annotations to this query plan.
   * The type-level `As & ValidAnnotations<'write', As>` gate rejects
   * read-only annotations at the call site; the runtime check fails
   * closed for callers that bypass the type gate. See `QueryBase.annotate`
   * in `./query-impl.ts` for the read-builder counterpart.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'write', As>
  ): InsertQuery<QC, AvailableScope, RowType> {
    return new InsertQueryImpl(
      this.#tableSource,
      this.#namespaceId,
      this.#table,
      this.#scope,
      this.#rows,
      this.ctx,
      this.#returningColumns,
      this.#rowFields,
      mergeWriteAnnotations(
        this.#annotations,
        annotations as readonly AnnotationValue<unknown, OperationKind>[],
      ),
    );
  }

  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>> {
    if (this.#rows.length === 0) {
      throw structuredError(
        'ORM.MUTATION_DATA_MISSING',
        'insert() called with an empty row array — at least one row is required',
      );
    }

    const paramRows = this.#rows.map((rowValues) =>
      buildParamValues(
        rowValues,
        this.#namespaceId,
        this.#table,
        this.#tableName,
        'create',
        this.ctx,
      ),
    );

    let ast = InsertAst.into(this.#tableSource).withRows(paramRows);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(
        buildReturningProjections(this.#tableName, this.#returningColumns, this.#rowFields),
      );
    }

    return buildQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>(
      ast,
      this.ctx,
      this.#annotations,
    );
  }
}

export class UpdateQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends BuilderBase<QC['capabilities']>
  implements UpdateQuery<QC, AvailableScope, RowType>
{
  readonly #tableSource: TableSource;
  readonly #tableName: string;
  readonly #scope: Scope;
  readonly #setExpressions: Record<string, AstExpression>;
  readonly #whereExprs: readonly AstExpression[];
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;
  readonly #annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;

  constructor(
    tableSource: TableSource,
    scope: Scope,
    setExpressions: Record<string, AstExpression>,
    ctx: BuilderContext,
    whereExprs: readonly AstExpression[] = [],
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
    annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> = new Map(),
  ) {
    super(ctx);
    this.#tableSource = tableSource;
    this.#tableName = tableSource.name;
    this.#scope = scope;
    this.#setExpressions = setExpressions;
    this.#whereExprs = whereExprs;
    this.#returningColumns = returningColumns;
    this.#rowFields = rowFields;
    this.#annotations = annotations;
  }

  where(expr: ExpressionBuilder<AvailableScope, QC>): UpdateQuery<QC, AvailableScope, RowType> {
    const fieldProxy = createFieldProxy(this.#scope);
    const fns = createFunctions(this.ctx.queryOperationTypes, this.ctx.rawCodecInferer);
    const result = (expr as ExpressionBuilder<Scope, QueryContext>)(fieldProxy, fns as never);
    return new UpdateQueryImpl(
      this.#tableSource,
      this.#scope,
      this.#setExpressions,
      this.ctx,
      [...this.#whereExprs, result.buildAst()],
      this.#returningColumns,
      this.#rowFields,
      this.#annotations,
    );
  }

  returning = this._gate<ReturningCapability, string[], UpdateQuery<QC, AvailableScope, never>>(
    { sql: { returning: true } },
    'returning',
    (...columns: string[]) => {
      const newRowFields: Record<string, ScopeField> = {};
      for (const col of columns) {
        const field = this.#scope.topLevel[col];
        if (!field)
          throw structuredError('ORM.COLUMN_UNKNOWN', `Column "${col}" not found in scope`, {
            meta: { column: col },
          });
        newRowFields[col] = field;
      }
      return new UpdateQueryImpl(
        this.#tableSource,
        this.#scope,
        this.#setExpressions,
        this.ctx,
        this.#whereExprs,
        columns,
        newRowFields,
        this.#annotations,
      ) as unknown as UpdateQuery<QC, AvailableScope, never>;
    },
  );

  /**
   * Attach one or more write-typed annotations to this query plan.
   * See `InsertQueryImpl.annotate` for semantics; the runtime check
   * fails closed for callers that bypass the type-level gate.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'write', As>
  ): UpdateQuery<QC, AvailableScope, RowType> {
    return new UpdateQueryImpl(
      this.#tableSource,
      this.#scope,
      this.#setExpressions,
      this.ctx,
      this.#whereExprs,
      this.#returningColumns,
      this.#rowFields,
      mergeWriteAnnotations(
        this.#annotations,
        annotations as readonly AnnotationValue<unknown, OperationKind>[],
      ),
    );
  }

  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>> {
    let ast = UpdateAst.table(this.#tableSource)
      .withSet(this.#setExpressions)
      .withWhere(combineWhereExprs(this.#whereExprs));

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(
        buildReturningProjections(this.#tableName, this.#returningColumns, this.#rowFields),
      );
    }

    return buildQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>(
      ast,
      this.ctx,
      this.#annotations,
    );
  }
}

export class DeleteQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends BuilderBase<QC['capabilities']>
  implements DeleteQuery<QC, AvailableScope, RowType>
{
  readonly #tableSource: TableSource;
  readonly #tableName: string;
  readonly #scope: Scope;
  readonly #whereCallbacks: readonly WhereCallback[];
  readonly #returningColumns: string[];
  readonly #rowFields: Record<string, ScopeField>;
  readonly #annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;

  constructor(
    tableSource: TableSource,
    scope: Scope,
    ctx: BuilderContext,
    whereCallbacks: readonly WhereCallback[] = [],
    returningColumns: string[] = [],
    rowFields: Record<string, ScopeField> = {},
    annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> = new Map(),
  ) {
    super(ctx);
    this.#tableSource = tableSource;
    this.#tableName = tableSource.name;
    this.#scope = scope;
    this.#whereCallbacks = whereCallbacks;
    this.#returningColumns = returningColumns;
    this.#rowFields = rowFields;
    this.#annotations = annotations;
  }

  where(expr: ExpressionBuilder<AvailableScope, QC>): DeleteQuery<QC, AvailableScope, RowType> {
    return new DeleteQueryImpl(
      this.#tableSource,
      this.#scope,
      this.ctx,
      [...this.#whereCallbacks, expr as unknown as WhereCallback],
      this.#returningColumns,
      this.#rowFields,
      this.#annotations,
    );
  }

  returning = this._gate<ReturningCapability, string[], DeleteQuery<QC, AvailableScope, never>>(
    { sql: { returning: true } },
    'returning',
    (...columns: string[]) => {
      const newRowFields: Record<string, ScopeField> = {};
      for (const col of columns) {
        const field = this.#scope.topLevel[col];
        if (!field)
          throw structuredError('ORM.COLUMN_UNKNOWN', `Column "${col}" not found in scope`, {
            meta: { column: col },
          });
        newRowFields[col] = field;
      }
      return new DeleteQueryImpl(
        this.#tableSource,
        this.#scope,
        this.ctx,
        this.#whereCallbacks,
        columns,
        newRowFields,
        this.#annotations,
      ) as unknown as DeleteQuery<QC, AvailableScope, never>;
    },
  );

  /**
   * Attach one or more write-typed annotations to this query plan.
   * See `InsertQueryImpl.annotate` for semantics.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'write', As>
  ): DeleteQuery<QC, AvailableScope, RowType> {
    return new DeleteQueryImpl(
      this.#tableSource,
      this.#scope,
      this.ctx,
      this.#whereCallbacks,
      this.#returningColumns,
      this.#rowFields,
      mergeWriteAnnotations(
        this.#annotations,
        annotations as readonly AnnotationValue<unknown, OperationKind>[],
      ),
    );
  }

  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>> {
    const whereExpr = combineWhereExprs(
      this.#whereCallbacks.map((cb) =>
        evaluateWhere(cb, this.#scope, this.ctx.queryOperationTypes, this.ctx.rawCodecInferer),
      ),
    );

    let ast = DeleteAst.from(this.#tableSource).withWhere(whereExpr);

    if (this.#returningColumns.length > 0) {
      ast = ast.withReturning(
        buildReturningProjections(this.#tableName, this.#returningColumns, this.#rowFields),
      );
    }

    return buildQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>(
      ast,
      this.ctx,
      this.#annotations,
    );
  }
}

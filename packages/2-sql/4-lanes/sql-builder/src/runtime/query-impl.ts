import type {
  AnnotationValue,
  OperationKind,
  ValidAnnotations,
} from '@internal/framework-components/runtime';
import { assertAnnotationsApplicable } from '@internal/framework-components/runtime';
import {
  DerivedTableSource,
  LockingClause,
  type LockStrength,
  type LockWaitRequest,
  lockOptionCapabilities,
  lockStrengthCapabilities,
  lockWaitPolicyOf,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { toExpr } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';
import type {
  AggregateFunctions,
  BooleanCodecType,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  Functions,
  OrderByOptions,
  OrderByScope,
  WithField,
  WithFields,
} from '../expression';
import type { ResolveRow } from '../resolve';
import type {
  Expand,
  JoinOuterScope,
  JoinSource,
  QueryContext,
  Scope,
  ScopeField,
  // biome-ignore lint/correctness/noUnusedImports: used in `declare` property
  SubqueryMarker,
} from '../scope';
import type { GroupedQuery } from '../types/grouped-query';
import type { SelectQuery } from '../types/select-query';
import type { PaginationValue } from '../types/shared';
import {
  assertCapability,
  assertNotLocked,
  BuilderBase,
  type BuilderContext,
  type BuilderState,
  buildPlan,
  buildSelectAst,
  cloneState,
  orderByScopeOf,
  resolveDistinctOn,
  resolveGroupBy,
  resolveOrderBy,
  resolveSelectArgs,
} from './builder-base';
import { createFieldProxy } from './field-proxy';
import { createAggregateFunctions, createFunctions } from './functions';

abstract class QueryBase<
  QC extends QueryContext = QueryContext,
  AvailableScope extends Scope = Scope,
  RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
> extends BuilderBase<QC['capabilities']> {
  protected readonly state: BuilderState;

  constructor(state: BuilderState, ctx: BuilderContext) {
    super(ctx);
    this.state = state;
  }

  protected abstract clone(state: BuilderState): this;

  distinctOn = this._gate(
    { postgres: { distinctOn: true } },
    'distinctOn',
    (...args: unknown[]) => {
      const exprs = resolveDistinctOn(args, this.state.scope, this.state.rowFields, this.ctx);
      return this.clone(
        cloneState(this.state, {
          distinctOn: [...(this.state.distinctOn ?? []), ...exprs],
        }),
      );
    },
  );

  limit(count: PaginationValue<QC>): this {
    const limit = typeof count === 'number' ? count : toExpr(count);
    return this.clone(cloneState(this.state, { limit }));
  }

  offset(count: PaginationValue<QC>): this {
    const offset = typeof count === 'number' ? count : toExpr(count);
    return this.clone(cloneState(this.state, { offset }));
  }

  distinct(): this {
    return this.clone(cloneState(this.state, { distinct: true }));
  }

  /**
   * Attach one or more annotations to this query plan.
   *
   * Read builders (`SelectQueryImpl`, `GroupedQueryImpl`) accept
   * annotations whose declared `applicableTo` includes `'read'`.
   * The type-level `As & ValidAnnotations<'read', As>` gate rejects
   * write-only annotations at the call site; the runtime check below
   * fails closed for callers that bypass the type gate (cast / `any`).
   *
   * Multiple `.annotate(...)` calls compose; duplicate namespaces use
   * last-write-wins. The accumulated annotations are merged into
   * `plan.meta.annotations` at `.build()` time, alongside any framework-
   * internal metadata under reserved namespaces (e.g. `codecs`).
   *
   * Chainable in any position (before / after `.where`, `.select`,
   * `.limit`, etc.); the returned builder has the same row type.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'read', As>
  ): this {
    assertAnnotationsApplicable(
      annotations as readonly AnnotationValue<unknown, OperationKind>[],
      'read',
      'sql-dsl.annotate',
    );
    const next = new Map(this.state.annotations);
    for (const annotation of annotations as readonly AnnotationValue<unknown, OperationKind>[]) {
      next.set(annotation.namespace, annotation);
    }
    return this.clone(cloneState(this.state, { annotations: next }));
  }

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType>;
  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType>;
  groupBy(...args: unknown[]): unknown {
    const exprs = resolveGroupBy(args, this.state.scope, this.state.rowFields, this.ctx);
    return new GroupedQueryImpl<QC, AvailableScope, RowType>(
      cloneState(this.state, { groupBy: [...this.state.groupBy, ...exprs] }),
      this.ctx,
    );
  }

  as<Alias extends string>(alias: Alias): JoinSource<RowType, Alias> {
    assertNotLocked(this.state);
    const ast = buildSelectAst(this.state);
    const derivedSource = DerivedTableSource.as(alias, ast);
    const scope = {
      topLevel: this.state.rowFields as RowType,
      namespaces: { [alias]: this.state.rowFields } as Record<Alias, RowType>,
    };
    return {
      getJoinOuterScope: () => scope,
      buildAst: () => derivedSource,

      // `as unknown` is necessary, because JoinOuterScope is a phantom type-only property that does not exist at runtime
    } satisfies Omit<JoinSource<RowType, Alias>, typeof JoinOuterScope> as unknown as JoinSource<
      RowType,
      Alias
    >;
  }

  getRowFields(): Record<string, ScopeField> {
    return this.state.rowFields;
  }

  buildAst(): SelectAst {
    assertNotLocked(this.state);
    return buildSelectAst(this.state);
  }

  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>> {
    return buildPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>(
      this.state,
      this.ctx,
    );
  }
}

export class SelectQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends QueryBase<QC, AvailableScope, RowType>
  implements SelectQuery<QC, AvailableScope, RowType>
{
  declare readonly [SubqueryMarker]: RowType;

  protected clone(state: BuilderState): this {
    return new SelectQueryImpl<QC, AvailableScope, RowType>(state, this.ctx) as this;
  }

  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<QC, AvailableScope, WithFields<RowType, AvailableScope['topLevel'], Columns>>;
  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<RowType, Field, Alias>>;
  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<RowType & ExtractScopeFields<Result>>>;
  select(...args: unknown[]): unknown {
    const { projections, newRowFields } = resolveSelectArgs(args, this.state.scope, this.ctx);
    return new SelectQueryImpl(
      cloneState(this.state, {
        projections: [...this.state.projections, ...projections],
        rowFields: { ...this.state.rowFields, ...newRowFields },
      }),
      this.ctx,
    );
  }

  where(expr: ExpressionBuilder<AvailableScope, QC>): SelectQuery<QC, AvailableScope, RowType> {
    const fieldProxy = createFieldProxy(this.state.scope);
    const fns = createFunctions<QC>(this.ctx.queryOperationTypes, this.ctx.rawCodecInferer);
    const result = (expr as ExpressionBuilder<Scope, QueryContext>)(fieldProxy, fns as never);
    return new SelectQueryImpl(
      cloneState(this.state, {
        where: [...this.state.where, result.buildAst()],
      }),
      this.ctx,
    );
  }

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType>;
  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): SelectQuery<QC, AvailableScope, RowType>;
  orderBy(arg: unknown, options?: OrderByOptions): unknown {
    const item = resolveOrderBy(
      arg,
      options,
      this.state.scope,
      this.state.rowFields,
      this.ctx,
      false,
    );
    return this.clone(cloneState(this.state, { orderBy: [...this.state.orderBy, item] }));
  }

  forUpdate = this._gate(
    lockStrengthCapabilities.forUpdate,
    'forUpdate',
    (options?: LockRequest): SelectQuery<QC, AvailableScope, RowType> =>
      this.lock('forUpdate', options),
  );

  forNoKeyUpdate = this._gate(
    lockStrengthCapabilities.forNoKeyUpdate,
    'forNoKeyUpdate',
    (options?: LockRequest): SelectQuery<QC, AvailableScope, RowType> =>
      this.lock('forNoKeyUpdate', options),
  );

  forShare = this._gate(
    lockStrengthCapabilities.forShare,
    'forShare',
    (options?: LockRequest): SelectQuery<QC, AvailableScope, RowType> =>
      this.lock('forShare', options),
  );

  forKeyShare = this._gate(
    lockStrengthCapabilities.forKeyShare,
    'forKeyShare',
    (options?: LockRequest): SelectQuery<QC, AvailableScope, RowType> =>
      this.lock('forKeyShare', options),
  );

  private lock(strength: LockStrength, options: LockRequest | undefined): this {
    const of = options?.of !== undefined && options.of.length > 0 ? options.of : undefined;
    if (of !== undefined) {
      assertCapability(this.ctx, lockOptionCapabilities.of, strength);
    }
    const waitPolicy = lockWaitPolicyOf(strength, options);
    if (waitPolicy !== undefined) {
      assertCapability(this.ctx, lockOptionCapabilities[waitPolicy], strength);
    }
    const clause = LockingClause.of(strength, {
      ...ifDefined('of', of),
      ...ifDefined('waitPolicy', waitPolicy),
    });
    return this.clone(cloneState(this.state, { locking: [...(this.state.locking ?? []), clause] }));
  }
}

interface LockRequest extends LockWaitRequest {
  readonly of?: ReadonlyArray<string>;
}

export class GroupedQueryImpl<
    QC extends QueryContext = QueryContext,
    AvailableScope extends Scope = Scope,
    RowType extends Record<string, ScopeField> = Record<string, ScopeField>,
  >
  extends QueryBase<QC, AvailableScope, RowType>
  implements GroupedQuery<QC, AvailableScope, RowType>
{
  declare readonly [SubqueryMarker]: RowType;

  protected clone(state: BuilderState): this {
    return new GroupedQueryImpl<QC, AvailableScope, RowType>(state, this.ctx) as this;
  }

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<QC, AvailableScope, RowType> {
    const combined = orderByScopeOf(
      this.state.scope as AvailableScope,
      this.state.rowFields as RowType,
    );
    const fns = createAggregateFunctions<QC>(
      this.ctx.queryOperationTypes,
      this.ctx.rawCodecInferer,
      this.ctx.aggregates,
    );
    const result = expr(createFieldProxy(combined), fns);
    return new GroupedQueryImpl(cloneState(this.state, { having: result.buildAst() }), this.ctx);
  }

  orderBy(
    field: (keyof RowType | keyof AvailableScope['topLevel']) & string,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType>;
  orderBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<ScopeField>,
    options?: OrderByOptions,
  ): GroupedQuery<QC, AvailableScope, RowType>;
  orderBy(arg: unknown, options?: OrderByOptions): unknown {
    const item = resolveOrderBy(
      arg,
      options,
      this.state.scope,
      this.state.rowFields,
      this.ctx,
      true,
    );
    return this.clone(cloneState(this.state, { orderBy: [...this.state.orderBy, item] }));
  }
}

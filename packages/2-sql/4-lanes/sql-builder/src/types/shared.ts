import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  AggregateFunctions,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  TraitExpression,
  WithField,
  WithFields,
} from '../expression';
import type { ResolveRow } from '../resolve';
import type {
  EmptyRow,
  Expand,
  GatedMethod,
  JoinOuterScope,
  JoinSource,
  MergeScopes,
  NullableScope,
  QueryContext,
  Scope,
  ScopeField,
  ScopeTable,
  Subquery,
} from '../scope';
import type { JoinedTables } from './joined-tables';
import type { SelectQuery } from './select-query';

export interface LateralBuilder<QC extends QueryContext, ParentScope extends Scope> {
  from<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
  ): SelectQuery<QC, MergeScopes<ParentScope, Other[typeof JoinOuterScope]>, EmptyRow>;
}

export interface WithSelect<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField> = EmptyRow,
> {
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
}

export interface WithJoin<QC extends QueryContext, AvailableScope extends Scope, Capabilities> {
  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>>;

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>>;

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>>;

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>
  >;

  lateralJoin: GatedMethod<
    Capabilities,
    { sql: { lateral: true } },
    <Alias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: Alias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ) => JoinedTables<
      QC,
      MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
    >
  >;

  outerLateralJoin: GatedMethod<
    Capabilities,
    { sql: { lateral: true } },
    <Alias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: Alias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ) => JoinedTables<
      QC,
      MergeScopes<
        AvailableScope,
        NullableScope<{ topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
      >
    >
  >;
}

export type PaginationValue<QC extends QueryContext> =
  | number
  | TraitExpression<readonly ['numeric'], false, QC['codecTypes']>;

type LockOf<QC extends QueryContext, S extends Scope> = QC['capabilities'] extends {
  sql: { lockOf: true };
}
  ? { readonly of?: ReadonlyArray<keyof S['namespaces'] & string> }
  : { readonly of?: never };

type LockWaitOptions<QC extends QueryContext> =
  | (QC['capabilities'] extends { sql: { lockNowait: true } }
      ? { readonly nowait?: true; readonly skipLocked?: never }
      : never)
  | (QC['capabilities'] extends { sql: { lockSkipLocked: true } }
      ? { readonly skipLocked?: true; readonly nowait?: never }
      : never)
  | { readonly nowait?: never; readonly skipLocked?: never };

/** Options for the row-locking methods; each key exists only when the adapter reports its capability. */
export type LockOptions<QC extends QueryContext, S extends Scope> = LockOf<QC, S> &
  LockWaitOptions<QC>;

export interface WithPagination<QC extends QueryContext> {
  limit(count: PaginationValue<QC>): this;
  offset(count: PaginationValue<QC>): this;
}

export interface WithDistinct {
  distinct(): this;
}

export interface WithAlias<RowType extends Record<string, ScopeField>> {
  as<Alias extends string>(newAlias: Alias): JoinSource<RowType, Alias>;
}

export interface WithBuild<QC extends QueryContext, RowType extends Record<string, ScopeField>> {
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}

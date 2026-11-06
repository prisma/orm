import type {
  AnnotationValue,
  OperationKind,
  ValidAnnotations,
} from '@internal/framework-components/runtime';
import type {
  BooleanCodecType,
  Functions,
  Subquery,
} from '@internal/sql-relational-core/functions';
import type {
  AggregateFunctions,
  Expression,
  FieldProxy,
  OrderByOptions,
  OrderByScope,
} from '../expression';
import type { GatedMethod, QueryContext, Scope, ScopeField } from '../scope';
import type { WithAlias, WithBuild, WithDistinct, WithPagination } from './shared';

export interface GroupedQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends Subquery<RowType>,
    WithPagination<QC>,
    WithDistinct,
    WithAlias<RowType>,
    WithBuild<QC, RowType> {
  /**
   * Attach one or more read-typed annotations to this query plan.
   * Annotations declare `applicableTo: ['read']` (or `['read', 'write']`)
   * via `defineAnnotation`; write-only annotations fail to compile here.
   * Annotations are merged into `plan.meta.annotations` at `.build()` time.
   * Chainable in any position; multiple calls compose with last-write-wins
   * on duplicate namespaces.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'read', As>
  ): GroupedQuery<QC, AvailableScope, RowType>;

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType>;

  having(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: AggregateFunctions<QC>,
    ) => Expression<BooleanCodecType>,
  ): GroupedQuery<QC, AvailableScope, RowType>;

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

  distinctOn: GatedMethod<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    {
      (
        ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
      ): GroupedQuery<QC, AvailableScope, RowType>;
      (
        expr: (
          fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
          fns: Functions<QC>,
        ) => Expression<ScopeField>,
      ): GroupedQuery<QC, AvailableScope, RowType>;
    }
  >;
}

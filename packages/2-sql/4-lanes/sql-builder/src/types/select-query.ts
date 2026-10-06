import type {
  AnnotationValue,
  OperationKind,
  ValidAnnotations,
} from '@internal/framework-components/runtime';
import type {
  Expression,
  ExpressionBuilder,
  FieldProxy,
  Functions,
  OrderByOptions,
  OrderByScope,
} from '../expression';
import type { GatedMethod, QueryContext, Scope, ScopeField, Subquery } from '../scope';
import type { GroupedQuery } from './grouped-query';
import type {
  LockOptions,
  WithAlias,
  WithBuild,
  WithDistinct,
  WithPagination,
  WithSelect,
} from './shared';

export interface SelectQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> extends Subquery<RowType>,
    WithSelect<QC, AvailableScope, RowType>,
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
  ): SelectQuery<QC, AvailableScope, RowType>;

  where(expr: ExpressionBuilder<AvailableScope, QC>): SelectQuery<QC, AvailableScope, RowType>;

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

  groupBy(
    ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
  ): GroupedQuery<QC, AvailableScope, RowType>;

  groupBy(
    expr: (
      fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
      fns: Functions<QC>,
    ) => Expression<ScopeField>,
  ): GroupedQuery<QC, AvailableScope, RowType>;

  distinctOn: GatedMethod<
    QC['capabilities'],
    { postgres: { distinctOn: true } },
    {
      (
        ...fields: ((keyof RowType | keyof AvailableScope['topLevel']) & string)[]
      ): SelectQuery<QC, AvailableScope, RowType>;
      (
        expr: (
          fields: FieldProxy<OrderByScope<AvailableScope, RowType>>,
          fns: Functions<QC>,
        ) => Expression<ScopeField>,
      ): SelectQuery<QC, AvailableScope, RowType>;
    }
  >;

  /** Renders `FOR UPDATE`; the lock lasts until the enclosing transaction ends. */
  forUpdate: GatedMethod<
    QC['capabilities'],
    { sql: { forUpdate: true } },
    (options?: LockOptions<QC, AvailableScope>) => SelectQuery<QC, AvailableScope, RowType>
  >;

  /** Renders `FOR NO KEY UPDATE`; unlike `forUpdate`, it does not block foreign-key checks on the row. */
  forNoKeyUpdate: GatedMethod<
    QC['capabilities'],
    { postgres: { forNoKeyUpdate: true } },
    (options?: LockOptions<QC, AvailableScope>) => SelectQuery<QC, AvailableScope, RowType>
  >;

  /** Renders `FOR SHARE`. */
  forShare: GatedMethod<
    QC['capabilities'],
    { sql: { forShare: true } },
    (options?: LockOptions<QC, AvailableScope>) => SelectQuery<QC, AvailableScope, RowType>
  >;

  /** Renders `FOR KEY SHARE`. */
  forKeyShare: GatedMethod<
    QC['capabilities'],
    { postgres: { forKeyShare: true } },
    (options?: LockOptions<QC, AvailableScope>) => SelectQuery<QC, AvailableScope, RowType>
  >;
}

import type {
  AnnotationValue,
  OperationKind,
  ValidAnnotations,
} from '@internal/framework-components/runtime';
import type { StorageTable } from '@internal/sql-contract/types';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { ExpressionBuilder, WithFields } from '../expression';
import type { ResolveRow } from '../resolve';
import type { EmptyRow, GatedMethod, QueryContext, Scope, ScopeField } from '../scope';

export type ReturningCapability = { sql: { returning: true } };

export type ColumnValues<
  Table extends StorageTable,
  CT extends Record<string, { readonly input: unknown }>,
> = {
  [K in keyof Table['columns']]: Table['columns'][K]['codecId'] extends keyof CT
    ? CT[Table['columns'][K]['codecId']]['input']
    : unknown;
};

export type UpdateValues<
  Table extends StorageTable,
  CT extends Record<string, { readonly input: unknown }>,
> = Partial<ColumnValues<Table, CT>>;

export interface InsertQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  /**
   * Attach one or more write-typed annotations to this query plan.
   * Annotations declare `applicableTo: ['write']` (or `['read', 'write']`)
   * via `defineAnnotation`; read-only annotations fail to compile here.
   * Annotations are merged into `plan.meta.annotations` at `.build()` time.
   * Chainable in any position; multiple calls compose with last-write-wins
   * on duplicate namespaces.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'write', As>
  ): InsertQuery<QC, AvailableScope, RowType>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => InsertQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>
  >;
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}

export interface UpdateQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  /**
   * Attach one or more write-typed annotations to this query plan.
   * See `InsertQuery.annotate` for semantics.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'write', As>
  ): UpdateQuery<QC, AvailableScope, RowType>;
  where(expr: ExpressionBuilder<AvailableScope, QC>): UpdateQuery<QC, AvailableScope, RowType>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => UpdateQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>
  >;
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}

export interface DeleteQuery<
  QC extends QueryContext,
  AvailableScope extends Scope,
  RowType extends Record<string, ScopeField>,
> {
  /**
   * Attach one or more write-typed annotations to this query plan.
   * See `InsertQuery.annotate` for semantics.
   */
  annotate<As extends readonly AnnotationValue<unknown, OperationKind>[]>(
    ...annotations: As & ValidAnnotations<'write', As>
  ): DeleteQuery<QC, AvailableScope, RowType>;
  where(expr: ExpressionBuilder<AvailableScope, QC>): DeleteQuery<QC, AvailableScope, RowType>;
  returning: GatedMethod<
    QC['capabilities'],
    ReturningCapability,
    <Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
      ...columns: Columns
    ) => DeleteQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>
  >;
  build(): SqlQueryPlan<ResolveRow<RowType, QC['codecTypes'], QC['resolvedColumnOutputTypes']>>;
}

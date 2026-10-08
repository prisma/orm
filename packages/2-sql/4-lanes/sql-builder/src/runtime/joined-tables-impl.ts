import {
  AndExpr,
  DerivedTableSource,
  JoinAst,
  type TableSource,
} from '@internal/sql-relational-core/ast';
import type {
  AggregateFunctions,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  WithField,
  WithFields,
} from '../expression';
import type {
  EmptyRow,
  Expand,
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
import type { JoinedTables } from '../types/joined-tables';
import type { SelectQuery } from '../types/select-query';
import type { LateralBuilder } from '../types/shared';
import {
  BuilderBase,
  type BuilderContext,
  type BuilderState,
  cloneState,
  emptyState,
  mergeScopes,
  nullableScope,
  resolveSelectArgs,
} from './builder-base';
import { createFieldProxy } from './field-proxy';
import { createFunctions } from './functions';
import { SelectQueryImpl } from './query-impl';

export class JoinedTablesImpl<QC extends QueryContext, AvailableScope extends Scope>
  extends BuilderBase<QC['capabilities']>
  implements JoinedTables<QC, AvailableScope>
{
  readonly #state: BuilderState;

  constructor(state: BuilderState, ctx: BuilderContext) {
    super(ctx);
    this.#state = state;
  }

  lateralJoin = this._gate(
    { sql: { lateral: true } },
    'lateralJoin',
    <Alias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: Alias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ): JoinedTables<
      QC,
      MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
    > => {
      const { derivedSource, lateralScope } = this.#buildLateral(alias, builder);
      const resultScope = mergeScopes(
        this.#state.scope as AvailableScope,
        lateralScope as { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> },
      );
      return this.#addLateralJoin('inner', resultScope, derivedSource);
    },
  ) as JoinedTables<QC, AvailableScope>['lateralJoin'];

  outerLateralJoin = this._gate(
    { sql: { lateral: true } },
    'outerLateralJoin',
    <Alias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: Alias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ): JoinedTables<
      QC,
      MergeScopes<
        AvailableScope,
        NullableScope<{ topLevel: LateralRow; namespaces: Record<Alias, LateralRow> }>
      >
    > => {
      const { derivedSource, lateralScope } = this.#buildLateral(alias, builder);
      const resultScope = mergeScopes(
        this.#state.scope as AvailableScope,
        nullableScope(
          lateralScope as { topLevel: LateralRow; namespaces: Record<Alias, LateralRow> },
        ),
      );
      return this.#addLateralJoin('left', resultScope, derivedSource);
    },
  ) as JoinedTables<QC, AvailableScope>['outerLateralJoin'];

  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>;
  select<Alias extends string, Field extends ScopeField>(
    alias: Alias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<EmptyRow, Field, Alias>>;
  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<ExtractScopeFields<Result>>>;
  select(...args: unknown[]): unknown {
    const { projections, newRowFields } = resolveSelectArgs(args, this.#state.scope, this.ctx);
    return new SelectQueryImpl<QC, AvailableScope>(
      cloneState(this.#state, {
        projections: [...this.#state.projections, ...projections],
        rowFields: { ...this.#state.rowFields, ...newRowFields },
      }),
      this.ctx,
    );
  }

  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>> {
    const targetScope = mergeScopes(
      this.#state.scope as AvailableScope,
      other.getJoinOuterScope() as Other[typeof JoinOuterScope],
    );
    return this.#addJoin(other, 'inner', targetScope, on);
  }

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>> {
    const targetScope = mergeScopes(
      this.#state.scope as AvailableScope,
      nullableScope(other.getJoinOuterScope() as Other[typeof JoinOuterScope]),
    );
    return this.#addJoin(other, 'left', targetScope, on);
  }

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>> {
    const targetScope = mergeScopes(
      nullableScope(this.#state.scope as AvailableScope),
      other.getJoinOuterScope() as Other[typeof JoinOuterScope],
    );
    return this.#addJoin(other, 'right', targetScope, on);
  }

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>
  > {
    const targetScope = mergeScopes(
      nullableScope(this.#state.scope as AvailableScope),
      nullableScope(other.getJoinOuterScope() as Other[typeof JoinOuterScope]),
    );
    return this.#addJoin(other, 'full', targetScope, on);
  }

  #addJoin<Other extends JoinSource<ScopeTable, string | never>, ResultScope extends Scope>(
    other: Other,
    joinType: 'inner' | 'left' | 'right' | 'full',
    resultScope: ResultScope,
    onExpr: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, ResultScope> {
    const fieldProxy = createFieldProxy(
      mergeScopes(
        this.#state.scope as AvailableScope,
        other.getJoinOuterScope() as Other[typeof JoinOuterScope],
      ),
    ) as FieldProxy<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>>;
    const fns = createFunctions<QC>(this.ctx.queryOperationTypes, this.ctx.rawCodecInferer);
    const onResult = onExpr(fieldProxy, fns);
    const joinAst = new JoinAst(joinType, other.buildAst(), onResult.buildAst());

    return new JoinedTablesImpl(
      cloneState(this.#state, {
        joins: [...this.#state.joins, joinAst],
        scope: resultScope,
      }),
      this.ctx,
    );
  }

  #buildLateral(
    alias: string,
    builderFn: (
      lateral: LateralBuilder<QC, AvailableScope>,
    ) => Subquery<Record<string, ScopeField>>,
  ) {
    const lateralBuilder: LateralBuilder<QC, AvailableScope> = {
      from: (other) => {
        const otherScope = other.getJoinOuterScope();
        const parentMerged = mergeScopes(this.#state.scope, otherScope);
        return new SelectQueryImpl(
          emptyState(other.buildAst() as TableSource, parentMerged),
          this.ctx,
        ) as unknown as SelectQuery<
          QC,
          MergeScopes<AvailableScope, (typeof other)[typeof JoinOuterScope]>,
          EmptyRow
        >;
      },
    };

    const subquery = builderFn(lateralBuilder);
    const subqueryAst = subquery.buildAst();
    const derivedSource = DerivedTableSource.as(alias, subqueryAst);
    const subqueryRowFields: ScopeTable = subquery.getRowFields();
    const lateralScope: Scope = {
      topLevel: subqueryRowFields,
      namespaces: { [alias]: subqueryRowFields },
    };

    return { derivedSource, lateralScope };
  }

  #addLateralJoin<ResultScope extends Scope>(
    joinType: 'inner' | 'left',
    resultScope: ResultScope,
    derivedSource: DerivedTableSource,
  ): JoinedTables<QC, ResultScope> {
    const onExpr = AndExpr.of([]);
    const joinAst = new JoinAst(joinType, derivedSource, onExpr, true);

    return new JoinedTablesImpl(
      cloneState(this.#state, {
        joins: [...this.#state.joins, joinAst],
        scope: resultScope,
      }),
      this.ctx,
    );
  }
}

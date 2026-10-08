import type { StorageTable } from '@internal/sql-contract/types';
import { type AnyFromSource, ColumnRef, type TableSource } from '@internal/sql-relational-core/ast';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';
import type {
  AggregateFunctions,
  Expression,
  ExpressionBuilder,
  ExtractScopeFields,
  FieldProxy,
  Functions,
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
  RebindScope,
  Scope,
  ScopeField,
  ScopeTable,
  StorageTableToScopeTable,
  Subquery,
} from '../scope';
import type { NamespaceTable, TableProxyContract } from '../types/db';
import type { IndexReference } from '../types/index-reference';
import type { JoinedTables } from '../types/joined-tables';
import type { DeleteQuery, InsertQuery, UpdateQuery } from '../types/mutation-query';
import type { SelectQuery } from '../types/select-query';
import type { LateralBuilder } from '../types/shared';
import type { TableProxy } from '../types/table-proxy';
import { BuilderBase, type BuilderContext, emptyState, tableToScope } from './builder-base';
import { ExpressionImpl } from './expression-impl';
import { JoinedTablesImpl } from './joined-tables-impl';
import {
  buildParamValues,
  buildSetExpressions,
  DeleteQueryImpl,
  evaluateUpdateCallback,
  InsertQueryImpl,
  UpdateQueryImpl,
  type UpdateSetCallback,
} from './mutation-impl';
import { SelectQueryImpl } from './query-impl';
import { tableSourceForProxy } from './table-source-for-proxy';

export class TableProxyImpl<
    C extends TableProxyContract,
    Name extends string,
    Alias extends string,
    AvailableScope extends Scope,
    QC extends QueryContext,
    NsId extends string = string,
  >
  extends BuilderBase<C['capabilities']>
  implements TableProxy<C, NsId, Name, Alias, AvailableScope, QC>
{
  declare readonly [JoinOuterScope]: JoinSource<
    StorageTableToScopeTable<NamespaceTable<C, NsId, Name>>,
    Alias
  >[typeof JoinOuterScope];

  readonly #tableName: string;
  readonly #alias: string;
  readonly #table: StorageTable;
  readonly #namespaceId: string;
  readonly #fromSource: TableSource;
  readonly #scope: Scope;
  #indexes: TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['indexes'] | undefined;

  constructor(
    tableName: string,
    table: StorageTable,
    alias: string,
    ctx: BuilderContext,
    namespaceId: string,
  ) {
    super(ctx);
    this.#tableName = tableName;
    this.#alias = alias;
    this.#table = table;
    this.#namespaceId = namespaceId;
    this.#scope = tableToScope(alias, table, {
      storage: ctx.storage,
      tableName,
      namespaceId,
    });
    this.#fromSource = tableSourceForProxy(tableName, alias, namespaceId);
  }

  /**
   * The table's columns, each as the codec descriptor a raw row spec reads.
   * The declared type resolves each column's output through the contract; the
   * value carries what the storage table states.
   */
  get columns(): TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['columns'] {
    const refs = Object.fromEntries(
      Object.entries(this.#table.columns).map(([name, column]) => [
        name,
        { codecId: column.codecId, nullable: column.nullable },
      ]),
    );
    return blindCast<
      TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['columns'],
      "the storage table states each column's codec and nullability at runtime; the declared type is the contract's own statement about the same columns, which a runtime value cannot carry"
    >(Object.freeze(refs));
  }

  /**
   * The table's indexes, keyed by the name the contract source gave each. An index's columns are this table's columns under its alias, so `post.as('p').indexes.post_search` reads `p`'s columns. A name more than one index shares is refused when it is read.
   */
  get indexes(): TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['indexes'] {
    this.#indexes ??= this.#indexReferences();
    return this.#indexes;
  }

  #indexReferences(): TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['indexes'] {
    const fields = this.#scope.namespaces[this.#alias];
    assertDefined(fields, 'a table proxy scopes its own alias');
    const byName = new Map<string, IndexReference[]>();
    for (const index of this.#table.indexes) {
      const authoredName = index.prefix ?? index.name;
      const columns = Object.fromEntries(
        (index.columns ?? []).map((column) => {
          const field = fields[column];
          assertDefined(field, `index "${index.name}" covers a column of its table`);
          return [column, new ExpressionImpl(ColumnRef.of(this.#alias, column), field)];
        }),
      );
      const reference = Object.freeze({
        columns: Object.freeze(columns),
        type: index.type,
        options: index.options,
      });
      byName.set(authoredName, [...(byName.get(authoredName) ?? []), reference]);
    }
    const references = {};
    for (const [authoredName, [reference, ...others]] of byName) {
      Object.defineProperty(references, authoredName, {
        enumerable: true,
        get: () => {
          if (others.length > 0) throw this.#ambiguousIndexName(authoredName);
          return reference;
        },
      });
    }
    return blindCast<
      TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['indexes'],
      "the storage table states each index's name, columns, type and options at runtime; the declared type is the contract's own statement about the same indexes"
    >(Object.freeze(references));
  }

  #ambiguousIndexName(authoredName: string) {
    return structuredError(
      'ORM.ARGUMENT_INVALID',
      `Table "${this.#tableName}" has more than one index named "${authoredName}".`,
      {
        why: 'An index is read by the name its contract source gave it, and these indexes share that name.',
        fix: `Give each of these indexes of table "${this.#tableName}" its own name in the contract source.`,
        meta: { namespaceId: this.#namespaceId, tableName: this.#tableName, index: authoredName },
      },
    );
  }

  lateralJoin = this._gate(
    { sql: { lateral: true } },
    'lateralJoin',
    <LAlias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: LAlias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ): JoinedTables<
      QC,
      MergeScopes<AvailableScope, { topLevel: LateralRow; namespaces: Record<LAlias, LateralRow> }>
    > => {
      return this.#toJoined().lateralJoin(alias, builder);
    },
  ) as TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['lateralJoin'];

  outerLateralJoin = this._gate(
    { sql: { lateral: true } },
    'outerLateralJoin',
    <LAlias extends string, LateralRow extends Record<string, ScopeField>>(
      alias: LAlias,
      builder: (lateral: LateralBuilder<QC, AvailableScope>) => Subquery<LateralRow>,
    ): JoinedTables<
      QC,
      MergeScopes<
        AvailableScope,
        NullableScope<{ topLevel: LateralRow; namespaces: Record<LAlias, LateralRow> }>
      >
    > => {
      return this.#toJoined().outerLateralJoin(alias, builder);
    },
  ) as TableProxy<C, NsId, Name, Alias, AvailableScope, QC>['outerLateralJoin'];

  getJoinOuterScope(): Scope {
    return this.#scope;
  }

  buildAst(): AnyFromSource {
    return this.#fromSource;
  }

  as<NewAlias extends string>(
    newAlias: NewAlias,
  ): TableProxy<C, NsId, Name, NewAlias, RebindScope<AvailableScope, Alias, NewAlias>, QC> {
    return new TableProxyImpl<
      C,
      Name,
      NewAlias,
      RebindScope<AvailableScope, Alias, NewAlias>,
      QC,
      NsId
    >(this.#tableName, this.#table, newAlias, this.ctx, this.#namespaceId);
  }

  select<Columns extends (keyof AvailableScope['topLevel'] & string)[]>(
    ...columns: Columns
  ): SelectQuery<QC, AvailableScope, WithFields<EmptyRow, AvailableScope['topLevel'], Columns>>;
  select<LAlias extends string, Field extends ScopeField>(
    alias: LAlias,
    expr: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Expression<Field>,
  ): SelectQuery<QC, AvailableScope, WithField<EmptyRow, Field, LAlias>>;
  select<Result extends Record<string, Expression<ScopeField>>>(
    callback: (fields: FieldProxy<AvailableScope>, fns: AggregateFunctions<QC>) => Result,
  ): SelectQuery<QC, AvailableScope, Expand<ExtractScopeFields<Result>>>;
  select(...args: unknown[]): unknown {
    return new SelectQueryImpl(emptyState(this.#fromSource, this.#scope), this.ctx).select(
      ...(args as string[]),
    );
  }

  innerJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>> {
    return this.#toJoined().innerJoin(other, on);
  }

  outerLeftJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<AvailableScope, NullableScope<Other[typeof JoinOuterScope]>>> {
    return this.#toJoined().outerLeftJoin(other, on);
  }

  outerRightJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<QC, MergeScopes<NullableScope<AvailableScope>, Other[typeof JoinOuterScope]>> {
    return this.#toJoined().outerRightJoin(other, on);
  }

  outerFullJoin<Other extends JoinSource<ScopeTable, string | never>>(
    other: Other,
    on: ExpressionBuilder<MergeScopes<AvailableScope, Other[typeof JoinOuterScope]>, QC>,
  ): JoinedTables<
    QC,
    MergeScopes<NullableScope<AvailableScope>, NullableScope<Other[typeof JoinOuterScope]>>
  > {
    return this.#toJoined().outerFullJoin(other, on);
  }

  insert(rows: ReadonlyArray<Record<string, unknown>>): InsertQuery<QC, AvailableScope, EmptyRow> {
    return new InsertQueryImpl(
      this.#fromSource,
      this.#namespaceId,
      this.#table,
      this.#scope,
      rows,
      this.ctx,
    );
  }

  update(
    setOrCallback:
      | Record<string, unknown>
      | ((
          fields: FieldProxy<AvailableScope>,
          fns: Functions<QC>,
        ) => Record<string, Expression<ScopeField> | undefined>),
  ): UpdateQuery<QC, AvailableScope, EmptyRow> {
    if (typeof setOrCallback === 'function') {
      const callbackExprs = evaluateUpdateCallback(
        setOrCallback as UpdateSetCallback,
        this.#scope,
        this.ctx.queryOperationTypes,
        this.ctx.rawCodecInferer,
      );
      const setExpressions = buildSetExpressions(
        callbackExprs,
        this.#namespaceId,
        this.#table,
        this.#tableName,
        'update',
        this.ctx,
      );
      return new UpdateQueryImpl(this.#fromSource, this.#scope, setExpressions, this.ctx);
    }
    const setExpressions = buildParamValues(
      setOrCallback,
      this.#namespaceId,
      this.#table,
      this.#tableName,
      'update',
      this.ctx,
    );
    return new UpdateQueryImpl(this.#fromSource, this.#scope, setExpressions, this.ctx);
  }

  delete(): DeleteQuery<QC, AvailableScope, EmptyRow> {
    return new DeleteQueryImpl(this.#fromSource, this.#scope, this.ctx);
  }

  #toJoined(): JoinedTables<QC, AvailableScope> {
    return new JoinedTablesImpl(emptyState(this.#fromSource, this.#scope), this.ctx);
  }
}

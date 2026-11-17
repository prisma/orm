import type { JsonValue, PlanMeta } from '@internal/contract/types';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
} from '@internal/framework-components/runtime';
import type {
  AnyQueryAst,
  LoweredParam,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import type {
  AffectedCount,
  CodecTypesBase,
  CodecValue,
  Expression,
} from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { RuntimeScope } from '@internal/sql-relational-core/types';

export type ParamSpec<CT extends CodecTypesBase = CodecTypesBase> =
  | (keyof CT & string)
  | {
      readonly codecId: keyof CT & string;
      readonly typeParams?: JsonValue;
      readonly nullable?: boolean;
    };

export type Declaration<CT extends CodecTypesBase = CodecTypesBase> = Readonly<
  Record<string, ParamSpec<CT>>
>;

export type DeclaredCodecId<S> = S extends string
  ? S
  : S extends { readonly codecId: infer C extends string }
    ? C
    : never;

export type DeclaredNullable<S> = S extends { readonly nullable: true } ? true : false;

export type BindSiteParams<D> = {
  readonly [K in keyof D]: Expression<{
    codecId: DeclaredCodecId<D[K]>;
    nullable: DeclaredNullable<D[K]>;
  }>;
};

export type ParamsFromDeclaration<D, CT extends CodecTypesBase> = {
  readonly [K in keyof D]: CodecValue<DeclaredCodecId<D[K]>, DeclaredNullable<D[K]>, CT>;
};

export type PrepareCallback<D, Row> = (params: BindSiteParams<D>) => SqlQueryPlan<Row>;

export interface PreparedStatement<Params, Row> {
  readonly sql: string;
  readonly ast: AnyQueryAst;
  readonly meta: PlanMeta;
  readonly slots: readonly LoweredParam[];
  readonly _params?: Params;
  readonly _row?: Row;
  query(
    target: RuntimeScope,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
}

/**
 * A prepared statement whose plan declares statement statistics rather than
 * rows. It carries the same lowered statement and bind slots as its
 * row-streaming sibling and differs in one way: it is consumed by executing
 * it, which resolves the statistics the statement reports.
 */
export interface PreparedExecution<Params> {
  readonly sql: string;
  readonly ast: AnyQueryAst;
  readonly meta: PlanMeta;
  readonly slots: readonly LoweredParam[];
  readonly _params?: Params;
  execute(
    target: RuntimeScope,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): Promise<SqlStatementStats>;
}

/**
 * The prepared handle a plan earns, keyed on the result the plan declares:
 * statistics prepare into a {@link PreparedExecution}, rows into a
 * {@link PreparedStatement}. The two faces share no consumption method, so a
 * handle cannot be read the wrong way round.
 *
 * The key is `AffectedCount`'s brand rather than the statistics shape, so a
 * row spec free to declare a column named `affectedRows` cannot select the
 * execution face by coincidence. This is the same fact `prepare()` reads at
 * runtime from the AST's declared result — one decision, stated twice.
 *
 * `never` is answered first because it satisfies every `extends`: a builder
 * state that projects nothing types its rows as `never`, and such a plan
 * declares rows in its AST, so it earns the statement face the runtime builds
 * for it.
 */
export type PreparedFor<Params, Row> = [Row] extends [never]
  ? PreparedStatement<Params, Row>
  : [Row] extends [AffectedCount]
    ? PreparedExecution<Params>
    : PreparedStatement<Params, Row>;

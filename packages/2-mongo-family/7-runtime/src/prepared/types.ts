import type { PlanMeta } from '@internal/contract/types';
import type {
  AsyncIterableResult,
  RuntimeExecuteOptions,
  RuntimeStatementStats,
} from '@internal/framework-components/runtime';
import type { MongoCodecInput, MongoCodecTypesBase } from '@internal/mongo-contract';
import type {
  AnyMongoCommand,
  DeleteManyCommand,
  DeleteOneCommand,
  MongoQueryExecutor,
  MongoQueryPlan,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import type { MongoPreparedParamRef } from '@internal/mongo-value';

export type MongoParamSpec<CT = MongoCodecTypesBase> =
  | (keyof CT & string)
  | { readonly codecId: keyof CT & string; readonly nullable?: boolean };

/** Each prepared parameter's name, mapped to its codec id or to `{ codecId, nullable }`. */
export type MongoDeclaration<CT = MongoCodecTypesBase> = Readonly<
  Record<string, MongoParamSpec<CT>>
>;

type DeclaredCodecId<S> = S extends string
  ? S
  : S extends { readonly codecId: infer C extends string }
    ? C
    : never;

type DeclaredNullable<S> = S extends { readonly nullable: true } ? true : false;

/** The placeholders a `prepare` callback receives, one per declared name. */
export type MongoPlaceholders<D> = {
  readonly [K in keyof D]: MongoPreparedParamRef<DeclaredCodecId<D[K]>, DeclaredNullable<D[K]>>;
};

/** The values each run of a prepared statement takes: each codec's input type, plus `null` when the parameter is nullable. */
export type MongoParamsFromDeclaration<D, CT> = {
  readonly [K in keyof D]:
    | MongoCodecInput<CT, DeclaredCodecId<D[K]> & keyof CT>
    | (DeclaredNullable<D[K]> extends true ? null : never);
};

export interface MongoPreparedStatement<Params, Row> {
  readonly meta: PlanMeta;
  readonly _params?: Params;
  readonly _row?: Row;
  query(
    target: MongoQueryExecutor,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
}

/** A prepared `updateOne`, `updateMany`, `deleteOne` or `deleteMany`, typed or raw. It also has `execute`, which returns the statement statistics. */
export interface MongoPreparedExecution<Params, Row> extends MongoPreparedStatement<Params, Row> {
  execute(
    target: MongoQueryExecutor,
    params: Params,
    options?: RuntimeExecuteOptions,
  ): Promise<RuntimeStatementStats>;
}

export type MongoStatisticsCommand =
  | UpdateOneCommand
  | UpdateManyCommand
  | DeleteOneCommand
  | DeleteManyCommand
  | RawUpdateOneCommand
  | RawUpdateManyCommand
  | RawDeleteOneCommand
  | RawDeleteManyCommand;

/** The handle a plan prepares into, picked from the plan's command type. */
export type MongoPreparedFor<Params, Row, Command> = [Command] extends [never]
  ? MongoPreparedStatement<Params, Row>
  : [Command] extends [MongoStatisticsCommand]
    ? MongoPreparedExecution<Params, Row>
    : MongoPreparedStatement<Params, Row>;

/** The `prepare` method of a runtime or client. `DefaultCodecTypes` is the codec types a declaration is checked against: a client binds them to its contract's. */
export interface MongoPrepareMember<
  DefaultCodecTypes extends MongoCodecTypesBase = MongoCodecTypesBase,
> {
  /**
   * Builds a reusable prepared statement. The callback runs once with one placeholder per declared name, and the plan it returns is lowered once. Each run of the handle fills in the values, runs `beforeEncode`, encodes with the declared codecs and sends the command. Does no I/O.
   *
   * Refuses an unknown codec id with `RUNTIME.CODEC_DESCRIPTOR_MISSING`, a placeholder in a raw command with `RUNTIME.PREPARE_RAW_PLACEHOLDER`, and a declared name the plan does not use with `RUNTIME.PREPARE_UNUSED_PARAM`.
   */
  prepare<
    D extends MongoDeclaration<CT>,
    Row,
    Command extends AnyMongoCommand,
    CT extends MongoCodecTypesBase = DefaultCodecTypes,
  >(
    declaration: D,
    callback: (placeholders: MongoPlaceholders<D>) => MongoQueryPlan<Row, Command>,
  ): Promise<MongoPreparedFor<MongoParamsFromDeclaration<D, CT>, Row, Command>>;
}

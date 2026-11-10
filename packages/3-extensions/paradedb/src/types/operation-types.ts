import type {
  QueryOperationTypesFunction,
  SqlQueryOperationTypes,
} from '@internal/sql-contract/types';
import type { CodecExpression, Expression } from '@internal/sql-relational-core/expression';
import type { ParadeDbProximityChain } from '../core/proximity-chain';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly paradeDbMatch: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        query: CodecExpression<'pg/text@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly paradeDbMatchAny: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        query: CodecExpression<'pg/text@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly paradeDbMatchAll: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        query: CodecExpression<'pg/text@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly paradeDbTerm: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        query: CodecExpression<'pg/text@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly paradeDbPhrase: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        query: CodecExpression<'pg/text@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly paradeDbScore: {
      readonly self: { readonly codecId: 'pg/int4@1' };
      readonly impl: (
        self: CodecExpression<'pg/int4@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/float4@1'; nullable: false }>;
    };
    readonly paradeDbFuzzy: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        distance: number,
      ) => Expression<{ codecId: 'pg/text@1'; nullable: false }>;
    };
    readonly paradeDbBoost: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        weight: number,
      ) => Expression<{ codecId: 'pg/text@1'; nullable: false }>;
    };
    readonly paradeDbConst: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        value: number,
      ) => Expression<{ codecId: 'pg/text@1'; nullable: false }>;
    };
    readonly paradeDbSlop: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (
        self: CodecExpression<'pg/text@1', boolean, CT>,
        slop: number,
      ) => Expression<{ codecId: 'pg/text@1'; nullable: false }>;
    };
    readonly paradeDbProximity: {
      readonly self: { readonly codecId: 'pg/text@1' };
      readonly impl: (start: CodecExpression<'pg/text@1', boolean, CT>) => ParadeDbProximityChain;
    };
  }
>;

/** {@link QueryOperationTypes} as a function of the contract's codec types, for a contract written in TypeScript. */
export interface QueryOperationTypesForCodecs extends QueryOperationTypesFunction {
  readonly queryOperationTypes: QueryOperationTypes<this['codecTypes']>;
}

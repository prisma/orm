import type {
  QueryOperationTypesFunction,
  SqlQueryOperationTypes,
} from '@internal/sql-contract/types';
import type { CodecExpression, Expression } from '@internal/sql-relational-core/expression';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

/**
 * Operation type definitions for the PostGIS extension.
 *
 * These are type-only signatures consumed by emitted `contract.d.ts`
 * files so the query builder surfaces `.distance()`, `.dwithin()`,
 * `.contains()`, `.within()`, `.intersects()`, and `.intersectsBbox()`
 * on `geometry` columns.
 */

export type OperationTypes = {
  readonly 'pg/geometry@1': {
    readonly distance: { readonly self: { readonly codecId: 'pg/geometry@1' } };
    readonly distanceSphere: { readonly self: { readonly codecId: 'pg/geometry@1' } };
    readonly dwithin: { readonly self: { readonly codecId: 'pg/geometry@1' } };
    readonly contains: { readonly self: { readonly codecId: 'pg/geometry@1' } };
    readonly within: { readonly self: { readonly codecId: 'pg/geometry@1' } };
    readonly intersects: { readonly self: { readonly codecId: 'pg/geometry@1' } };
    readonly intersectsBbox: { readonly self: { readonly codecId: 'pg/geometry@1' } };
  };
};

export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly distance: {
      readonly self: { readonly codecId: 'pg/geometry@1' };
      readonly impl: (
        self: CodecExpression<'pg/geometry@1', boolean, CT>,
        other: CodecExpression<'pg/geometry@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/float8@1'; nullable: false }>;
    };
    readonly distanceSphere: {
      readonly self: { readonly codecId: 'pg/geometry@1' };
      readonly impl: (
        self: CodecExpression<'pg/geometry@1', boolean, CT>,
        other: CodecExpression<'pg/geometry@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/float8@1'; nullable: false }>;
    };
    readonly dwithin: {
      readonly self: { readonly codecId: 'pg/geometry@1' };
      readonly impl: (
        self: CodecExpression<'pg/geometry@1', boolean, CT>,
        other: CodecExpression<'pg/geometry@1', boolean, CT>,
        distance: CodecExpression<'pg/float8@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly contains: {
      readonly self: { readonly codecId: 'pg/geometry@1' };
      readonly impl: (
        self: CodecExpression<'pg/geometry@1', boolean, CT>,
        other: CodecExpression<'pg/geometry@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly within: {
      readonly self: { readonly codecId: 'pg/geometry@1' };
      readonly impl: (
        self: CodecExpression<'pg/geometry@1', boolean, CT>,
        other: CodecExpression<'pg/geometry@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly intersects: {
      readonly self: { readonly codecId: 'pg/geometry@1' };
      readonly impl: (
        self: CodecExpression<'pg/geometry@1', boolean, CT>,
        other: CodecExpression<'pg/geometry@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly intersectsBbox: {
      readonly self: { readonly codecId: 'pg/geometry@1' };
      readonly impl: (
        self: CodecExpression<'pg/geometry@1', boolean, CT>,
        other: CodecExpression<'pg/geometry@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
  }
>;

/** {@link QueryOperationTypes} as a function of the contract's codec types, for a contract written in TypeScript. */
export interface QueryOperationTypesForCodecs extends QueryOperationTypesFunction {
  readonly queryOperationTypes: QueryOperationTypes<this['codecTypes']>;
}

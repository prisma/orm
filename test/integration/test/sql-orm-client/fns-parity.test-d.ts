import type { QueryOperationTypes as ParadeDbOperations } from '@internal/extension-paradedb/operation-types';
import type { QueryOperationTypes as PgvectorOperations } from '@internal/extension-pgvector/operation-types';
import type { QueryOperationTypes as PostgisOperations } from '@internal/extension-postgis/operation-types';
import type { ExtractCodecTypes, QueryOperationTypesBase } from '@internal/sql-contract/types';
import type { Orderable, OrmFunctionsOf } from '@internal/sql-orm-client';
import type { Expression } from '@internal/sql-relational-core/expression';
import type { QueryOperationTypes as PostgresOperations } from '@internal/target-postgres/operation-types';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from '../sql-builder/fixtures/generated/contract';

type CT = ExtractCodecTypes<Contract>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The operations whose ORM function does not keep the SQL query builder's signatures. */
type Mismatches<OT extends QueryOperationTypesBase> = {
  [K in keyof OT]: OrmFunctionsOf<CT, OT>[K] extends OT[K]['impl']
    ? Equal<Parameters<OrmFunctionsOf<CT, OT>[K]>, Parameters<OT[K]['impl']>> extends true
      ? never
      : K
    : K;
}[keyof OT];

type Text = Expression<{ codecId: 'pg/text@1'; nullable: false }>;

type ThreeOverloads = {
  readonly threeOverloads: {
    readonly impl: {
      (value: string): Text;
      (value: number): Text;
      (value: boolean): Text;
    };
  };
};

type OneSignature = {
  readonly oneSignature: { readonly impl: (value: string) => Text };
};

type TwoOverloads = {
  readonly twoOverloads: {
    readonly impl: {
      (value: string): Text;
      (value: number): Text;
    };
  };
};

type FourOverloads = {
  readonly fourOverloads: {
    readonly impl: {
      (value: string): Text;
      (value: number): Text;
      (value: boolean): Text;
      (value: bigint): Text;
    };
  };
};

type FiveOverloads = {
  readonly fiveOverloads: {
    readonly impl: {
      (value: Date): Text;
      (value: string): Text;
      (value: number): Text;
      (value: boolean): Text;
      (value: bigint): Text;
    };
  };
};

type Generic = {
  readonly generic: {
    readonly impl: <T extends string>(first: T, second: NoInfer<T>) => Text;
  };
};

describe('the ORM fns keep the signatures of every registered operation', () => {
  test('for the Postgres target', () => {
    expectTypeOf<Mismatches<PostgresOperations<CT>>>().toEqualTypeOf<never>();
  });

  test('for pgvector', () => {
    expectTypeOf<Mismatches<PgvectorOperations<CT>>>().toEqualTypeOf<never>();
  });

  test('for ParadeDB', () => {
    expectTypeOf<Mismatches<ParadeDbOperations<CT>>>().toEqualTypeOf<never>();
  });

  test('for PostGIS', () => {
    expectTypeOf<Mismatches<PostgisOperations<CT>>>().toEqualTypeOf<never>();
  });

  test('for an operation with one to four overloads', () => {
    expectTypeOf<Mismatches<OneSignature>>().toEqualTypeOf<never>();
    expectTypeOf<Mismatches<TwoOverloads>>().toEqualTypeOf<never>();
    expectTypeOf<Mismatches<ThreeOverloads>>().toEqualTypeOf<never>();
    expectTypeOf<Mismatches<FourOverloads>>().toEqualTypeOf<never>();
  });

  test('with one signature for an operation that has one', () => {
    expectTypeOf<OrmFunctionsOf<CT, OneSignature>['oneSignature']>().toEqualTypeOf<
      (value: string) => Text & Orderable
    >();
  });

  test('except the first of five overloads, which is dropped', () => {
    expectTypeOf<Mismatches<FiveOverloads>>().toEqualTypeOf<'fiveOverloads'>();
    expectTypeOf<FiveOverloads['fiveOverloads']['impl']>().toBeCallableWith(new Date());
    // @ts-expect-error the ORM keeps only the last four of five overloads
    expectTypeOf<OrmFunctionsOf<CT, FiveOverloads>['fiveOverloads']>().toBeCallableWith(new Date());
  });

  test('and keep the methods of a result', () => {
    expectTypeOf<
      ReturnType<OrmFunctionsOf<CT, ParadeDbOperations<CT>>['paradeDbProximity']>
    >().toHaveProperty('within');
  });

  test('except the type parameters of a generic operation, which take their constraints', () => {
    expectTypeOf<Generic['generic']['impl']>().toBeCallableWith('a', 'a');
    expectTypeOf<OrmFunctionsOf<CT, Generic>['generic']>().parameters.toEqualTypeOf<
      [first: string, second: string]
    >();
  });
});

import { describe, expectTypeOf, test } from 'vitest';
import type { PgvectorNearestMethods } from '../src/core/nearest-collection-method';
import type { Vector } from '../src/types/codec-types';

type VectorField<Length extends number> = {
  readonly nullable: true;
  readonly type: {
    readonly kind: 'scalar';
    readonly codecId: 'pg/vector@1';
    readonly typeParams: { readonly length: Length };
  };
};

type MethodsFor<Fields extends object> = (PgvectorNearestMethods & {
  readonly model: {
    readonly target: 'postgres';
    readonly name: 'Post';
    readonly fields: Fields;
    readonly relations: Record<never, never>;
    readonly table: { readonly columns: Record<never, never>; readonly indexes: readonly [] };
  };
})['methods'];

type PostFields = {
  readonly id: {
    readonly nullable: false;
    readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
  };
  readonly embedding: VectorField<1536>;
  readonly history: VectorField<3> & { readonly many: { readonly elementNullable: false } };
};

describe('the pgvector nearest-neighbour collection methods', () => {
  test('are one per vector field that is not a list, taking a vector of the field length, ordering only', () => {
    expectTypeOf<MethodsFor<PostFields>>().toEqualTypeOf<{
      readonly embedding_nearest: {
        readonly parameters: readonly [vector: Vector<1536>, maxDistance?: number];
        readonly filters: false;
        readonly orders: true;
      };
    }>();
  });

  test('accepts vectors of any length for an undimensioned field', () => {
    type Methods = MethodsFor<{
      readonly embedding: {
        readonly nullable: false;
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: 'pg/vector@1';
          readonly typeParams: Record<never, never>;
        };
      };
    }>;
    expectTypeOf<Methods['embedding_nearest']['parameters']>().toEqualTypeOf<
      readonly [vector: Vector, maxDistance?: number]
    >();
  });

  test('are none for a model with no vector field', () => {
    expectTypeOf<MethodsFor<Pick<PostFields, 'id'>>>().toEqualTypeOf<Record<never, never>>();
  });
});

test('a vector typed with another length is refused', () => {
  type Parameters = MethodsFor<PostFields>['embedding_nearest']['parameters'];
  const wrongLength: Vector<3> = [1, 2, 3];
  // @ts-expect-error the field holds vectors of length 1536
  const parameters: Parameters = [wrongLength];
  expectTypeOf(parameters).not.toBeAny();
});

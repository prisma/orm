import type { FieldAccessor, ResolveDotPathType } from '@internal/mongo-orm';
import type { Vector } from '@internal/target-mongo/codec-types';
import { describe, expectTypeOf, test } from 'vitest';
import type { contract } from '../contract-parity/fixtures/mongo/contract';
import type { Contract as Emitted } from '../contract-parity/fixtures/mongo/generated/contract';

type Built = typeof contract;

type SetValue<Expression> = Expression extends { set(value: infer Value): unknown } ? Value : never;

type HasNumericOps<Expression> = Expression extends { inc(value: never): unknown } ? true : false;

describe('update field accessors take the field input type of the contract', () => {
  test('an enum field takes the members of its enum', () => {
    expectTypeOf<SetValue<FieldAccessor<Built, 'User'>['role']>>().toEqualTypeOf<
      'reader' | 'editor'
    >();
    expectTypeOf<SetValue<FieldAccessor<Emitted, 'User'>['role']>>().toEqualTypeOf<
      'reader' | 'editor'
    >();
  });

  test('a list of enum values takes a list of members', () => {
    expectTypeOf<SetValue<FieldAccessor<Emitted, 'User'>['pastRoles']>>().toEqualTypeOf<
      readonly ('reader' | 'editor' | null)[]
    >();
  });

  test('a vector field takes its input type, which a Vector of its length satisfies', () => {
    expectTypeOf<SetValue<FieldAccessor<Emitted, 'User'>['embedding']>>().toEqualTypeOf<
      readonly number[]
    >();
    expectTypeOf<Vector<3>>().toExtend<SetValue<FieldAccessor<Emitted, 'User'>['embedding']>>();
  });

  test('a path into a value object, or into a list of them, takes the input type of the field it names', () => {
    expectTypeOf<
      ResolveDotPathType<Emitted, 'User', 'pastHomes.location.lat'>
    >().toEqualTypeOf<number>();
    expectTypeOf<ResolveDotPathType<Built, 'User', 'home.kind'>>().toEqualTypeOf<
      'reader' | 'editor' | null
    >();
    expectTypeOf<ResolveDotPathType<Emitted, 'User', 'home.kind'>>().toEqualTypeOf<
      'reader' | 'editor' | null
    >();
    expectTypeOf<ResolveDotPathType<Emitted, 'User', 'home.street'>>().toEqualTypeOf<string>();
  });
});

describe('numeric update operators', () => {
  test('a number field takes inc and mul, and a list of numbers does not', () => {
    expectTypeOf<HasNumericOps<FieldAccessor<Built, 'User'>['score']>>().toEqualTypeOf<true>();
    expectTypeOf<HasNumericOps<FieldAccessor<Emitted, 'User'>['score']>>().toEqualTypeOf<true>();
    expectTypeOf<HasNumericOps<FieldAccessor<Built, 'User'>['scores']>>().toEqualTypeOf<false>();
    expectTypeOf<HasNumericOps<FieldAccessor<Emitted, 'User'>['scores']>>().toEqualTypeOf<false>();
  });
});

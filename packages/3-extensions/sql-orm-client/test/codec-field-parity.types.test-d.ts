import type { Contract as SqlContract } from '@internal/contract/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import { describe, expectTypeOf, test } from 'vitest';
import type { CodecField, CollectionModelName, ModelAccessor } from '../src/types';
import type { Contract as ValueObjectContract } from './fixtures/value-objects/generated/contract';
import type { TestContract } from './helpers';

type AnyContract = SqlContract<SqlStorage>;

type Exactly<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ModelName<C extends AnyContract> = CollectionModelName<C>;
type Accessor<C extends AnyContract, M extends ModelName<C>> = ModelAccessor<C, M, 'public'>;

type ScalarFieldName<C extends AnyContract, M extends ModelName<C>> = {
  [F in keyof Accessor<C, M> & string]: Accessor<C, M>[F] extends {
    readonly returnType: unknown;
  }
    ? F
    : never;
}[keyof Accessor<C, M> & string];

type CodecFieldOf<C extends AnyContract, Field> = Field extends {
  readonly returnType: {
    readonly codecId: infer Id extends keyof ExtractCodecTypes<C> & string;
    readonly nullable: infer Nullable extends boolean;
  };
}
  ? CodecField<C, Id, Nullable>
  : never;

type MethodName<Field> = Exclude<keyof Field & string, 'returnType' | 'buildAst'>;

type MethodDifferences<Path extends string, Field, Codec> = {
  [K in MethodName<Field>]: K extends keyof Codec
    ? Field[K] extends (...args: infer FieldArgs) => unknown
      ? Codec[K] extends (...args: infer CodecArgs) => unknown
        ? Exactly<FieldArgs, CodecArgs> extends true
          ? never
          : `${Path}.${K}`
        : `${Path}.${K}`
      : never
    : `${Path}.${K}`;
}[MethodName<Field>];

type FieldDifferences<C extends AnyContract, M extends ModelName<C>> = {
  [F in ScalarFieldName<C, M>]: [CodecFieldOf<C, Accessor<C, M>[F]>] extends [never]
    ? never
    : Exactly<keyof Accessor<C, M>[F], keyof CodecFieldOf<C, Accessor<C, M>[F]>> extends true
      ? MethodDifferences<`${M}.${F}`, Accessor<C, M>[F], CodecFieldOf<C, Accessor<C, M>[F]>>
      : `${M}.${F} methods`;
}[ScalarFieldName<C, M>];

type FieldsWithoutCodecField<C extends AnyContract, M extends ModelName<C>> = {
  [F in ScalarFieldName<C, M>]: [CodecFieldOf<C, Accessor<C, M>[F]>] extends [never]
    ? `${M}.${F}`
    : never;
}[ScalarFieldName<C, M>];

type Differences<C extends AnyContract> = {
  [M in ModelName<C>]: FieldDifferences<C, M>;
}[ModelName<C>];

type Unmatched<C extends AnyContract> = {
  [M in ModelName<C>]: FieldsWithoutCodecField<C, M>;
}[ModelName<C>];

type ValueMethod = 'eq' | 'neq' | 'in' | 'notIn';

describe('CodecField against every scalar field of the test contract', () => {
  test('the comparison checks fields, not nothing', () => {
    expectTypeOf<ScalarFieldName<TestContract, 'Post'>>().toEqualTypeOf<
      'id' | 'title' | 'userId' | 'views' | 'embedding'
    >();
  });

  test('every scalar field of the test contract has a CodecField', () => {
    expectTypeOf<Unmatched<TestContract>>().toBeNever();
  });

  test('every method takes the same parameters', () => {
    expectTypeOf<Differences<TestContract>>().toBeNever();
  });
});

describe('CodecField against a value object field', () => {
  test('every scalar field has a CodecField', () => {
    expectTypeOf<Unmatched<ValueObjectContract>>().toBeNever();
  });

  test('every method takes the same parameters, except the value methods of the value object field, whose input type refines its codec input', () => {
    expectTypeOf<Differences<ValueObjectContract>>().toEqualTypeOf<`User.address.${ValueMethod}`>();
  });
});

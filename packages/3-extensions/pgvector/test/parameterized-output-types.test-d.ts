import type { FieldTypesFromDomain, ParameterizedOutputType } from '@internal/contract/types';
import { defineContract } from '@internal/postgres/contract-builder';
import { expectTypeOf, test } from 'vitest';
import type {
  CodecTypes,
  ParameterizedOutputTypesForTypeParams,
  Vector,
} from '../src/exports/codec-types';
import { vector } from '../src/exports/column-types';
import pgvector from '../src/exports/pack';

type VectorOutput<TypeParams extends Record<string, unknown>> = ParameterizedOutputType<
  ParameterizedOutputTypesForTypeParams,
  'pg/vector@1',
  TypeParams,
  CodecTypes['pg/vector@1']['output']
>;

test('a vector column with a length reads as a vector of that length', () => {
  expectTypeOf<VectorOutput<{ readonly length: 1536 }>>().toEqualTypeOf<Vector<1536>>();
  expectTypeOf<VectorOutput<{ readonly length: 3 }>>().toEqualTypeOf<Vector<3>>();
});

test('a vector column without a length reads as the plain vector type', () => {
  expectTypeOf<VectorOutput<Record<never, never>>>().toEqualTypeOf<
    CodecTypes['pg/vector@1']['output']
  >();
});

test('a contract written in TypeScript types vector() and pgvector.Vector() columns as number[]', () => {
  const contract = defineContract(
    { version: 18, extensions: { pgvector } },
    ({ field, model, type }) => ({
      models: {
        Doc: model('Doc', {
          fields: {
            id: field.column(type.Char(36)).id(),
            column: field.column(vector()),
            typeHelper: field.column(type.pgvector.Vector()),
            fixed: field.column(vector(3)),
          },
        }),
      },
    }),
  );
  type Fields = (typeof contract)['domain']['namespaces']['public']['models']['Doc']['fields'];
  type Output = FieldTypesFromDomain<
    { readonly public: { readonly models: { readonly Doc: { readonly fields: Fields } } } },
    CodecTypes,
    ParameterizedOutputTypesForTypeParams,
    Record<never, never>,
    'output',
    Record<never, never>
  >['public']['Doc'];

  expectTypeOf<Output['column']>().toEqualTypeOf<number[]>();
  expectTypeOf<Output['typeHelper']>().toEqualTypeOf<number[]>();
  expectTypeOf<Output['fixed']>().toEqualTypeOf<Vector<3>>();
});

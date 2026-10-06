/**
 * Type-level proof that a `many` storage column generates `ReadonlyArray<Element>`
 * in the no-emit (`FieldOutputType`) path in SqlContractResult.
 *
 * The emit path (`contract.d.ts` FieldOutputTypes) is driven by
 * `domain-type-generation.applyModifiers` in the framework emitter package,
 * which handles nested `many` metadata via the domain ContractField. That
 * behaviour is covered by the emitter's own tests.
 *
 * Container nullability: `T[]` → `ReadonlyArray<string>`;
 *                        `T[]?` → `ReadonlyArray<string> | null`.
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type {
  ExtractCodecTypes,
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
  ExtractStorageColumnInputTypes,
  ExtractStorageColumnTypes,
} from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { field, model } from '../src/contract-builder';
import type { SqlContractResult } from '../src/contract-types';

type TextCodecTypes = {
  readonly 'pg/text@1': { readonly input: string; readonly output: string };
};

// Target pack with __codecTypes required so CodecTypesFromDefinition resolves
// pg/text@1 → string without undefined in the union.
declare const typedPostgresPack: TargetPackRef<'sql', 'postgres'> & {
  readonly __codecTypes: TextCodecTypes;
};

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

// Declare a precisely-typed column descriptor so the codecId literal ('pg/text@1')
// flows through ScalarFieldState's descriptor generic and into FieldOutputType.
declare const textColumn: ColumnTypeDescriptor<'pg/text@1'>;
declare const elementsNullable: boolean;

const definition = {
  family: bareFamilyPack,
  target: typedPostgresPack,
  models: {
    Post: model('Post', {
      fields: {
        id: field.column(textColumn).id(),
        tags: field.column(textColumn).many(),
        explicitNonNullableElements: field.column(textColumn).many({ elementsNullable: false }),
        optTags: field.column(textColumn).many().optional(),
        nullableElementValues: field.column(textColumn).many({ elementsNullable: true }),
        chainedOmittedElements: field.column(textColumn).many({ elementsNullable: true }).many(),
        chainedFalseElements: field
          .column(textColumn)
          .many({ elementsNullable: true })
          .many({ elementsNullable: false }),
        nullableElementValuesAndList: field
          .column(textColumn)
          .many({ elementsNullable: true })
          .optional(),

        waivedElementCheck: field.column(textColumn).many().noCheck('elementNotNull'),
      },
    }).sql({ table: 'posts' }),
  },
};

type Contract = SqlContractResult<typeof definition>;
type FieldInputTypes = ExtractFieldInputTypes<Contract>['public']['Post'];
type FieldTypes = ExtractFieldOutputTypes<Contract>['public']['Post'];
type StorageOutputTypes = ExtractStorageColumnTypes<Contract>['public']['posts'];
type StorageInputTypes = ExtractStorageColumnInputTypes<Contract>['public']['posts'];

test('codec types include pg/text@1', () => {
  expectTypeOf<
    'pg/text@1' extends keyof ExtractCodecTypes<Contract> ? true : false
  >().toEqualTypeOf<true>();
});

test('omitted and false element nullability resolve identically', () => {
  expectTypeOf<FieldTypes['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<FieldInputTypes['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<FieldTypes['explicitNonNullableElements']>().toEqualTypeOf<FieldTypes['tags']>();
  expectTypeOf<FieldInputTypes['explicitNonNullableElements']>().toEqualTypeOf<
    FieldInputTypes['tags']
  >();
});

test('chained many calls restore strict element types', () => {
  expectTypeOf<FieldTypes['chainedOmittedElements']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<FieldInputTypes['chainedOmittedElements']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<FieldTypes['chainedFalseElements']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<FieldInputTypes['chainedFalseElements']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<StorageOutputTypes['chainedOmittedElements']>().toEqualTypeOf<
    ReadonlyArray<string>
  >();
  expectTypeOf<StorageInputTypes['chainedOmittedElements']>().toEqualTypeOf<
    ReadonlyArray<string>
  >();
  expectTypeOf<StorageOutputTypes['chainedFalseElements']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<StorageInputTypes['chainedFalseElements']>().toEqualTypeOf<ReadonlyArray<string>>();
});

test('nullable-container list field resolves to ReadonlyArray<string> | null', () => {
  expectTypeOf<FieldTypes['optTags']>().toEqualTypeOf<ReadonlyArray<string> | null>();
  expectTypeOf<FieldInputTypes['optTags']>().toEqualTypeOf<ReadonlyArray<string> | null>();
});

test('literal true includes null per element', () => {
  expectTypeOf<FieldTypes['nullableElementValues']>().toEqualTypeOf<ReadonlyArray<string | null>>();
  expectTypeOf<FieldInputTypes['nullableElementValues']>().toEqualTypeOf<
    ReadonlyArray<string | null>
  >();
});

test('many rejects invalid element nullability options', () => {
  // @ts-expect-error `elementsNullable` must be the literal `true` or literal `false`.
  field.column(textColumn).many({ elementsNullable });
  // @ts-expect-error `elementsNullable` is required when options are provided.
  field.column(textColumn).many({});
});

test('nullable-element nullable-container field composes both axes', () => {
  expectTypeOf<FieldTypes['nullableElementValuesAndList']>().toEqualTypeOf<ReadonlyArray<
    string | null
  > | null>();
  expectTypeOf<FieldInputTypes['nullableElementValuesAndList']>().toEqualTypeOf<ReadonlyArray<
    string | null
  > | null>();
});

test('noCheck element waiver does not change declared element type', () => {
  expectTypeOf<FieldTypes['waivedElementCheck']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<FieldInputTypes['waivedElementCheck']>().toEqualTypeOf<ReadonlyArray<string>>();
});

test('scalar field is unaffected', () => {
  expectTypeOf<FieldTypes['id']>().toEqualTypeOf<string>();
});

test('omitted and false storage element nullability resolve identically', () => {
  expectTypeOf<StorageOutputTypes['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<StorageInputTypes['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<StorageOutputTypes['explicitNonNullableElements']>().toEqualTypeOf<
    StorageOutputTypes['tags']
  >();
  expectTypeOf<StorageInputTypes['explicitNonNullableElements']>().toEqualTypeOf<
    StorageInputTypes['tags']
  >();
});

test('nullable-container list storage column resolves to ReadonlyArray<string> | null', () => {
  expectTypeOf<StorageOutputTypes['optTags']>().toEqualTypeOf<ReadonlyArray<string> | null>();
  expectTypeOf<StorageInputTypes['optTags']>().toEqualTypeOf<ReadonlyArray<string> | null>();
});

test('literal true storage elements include null', () => {
  expectTypeOf<StorageOutputTypes['nullableElementValues']>().toEqualTypeOf<
    ReadonlyArray<string | null>
  >();
  expectTypeOf<StorageInputTypes['nullableElementValues']>().toEqualTypeOf<
    ReadonlyArray<string | null>
  >();
});

test('nullable-element nullable-container storage column composes both axes', () => {
  expectTypeOf<StorageOutputTypes['nullableElementValuesAndList']>().toEqualTypeOf<ReadonlyArray<
    string | null
  > | null>();
  expectTypeOf<StorageInputTypes['nullableElementValuesAndList']>().toEqualTypeOf<ReadonlyArray<
    string | null
  > | null>();
});

test('waived storage element check keeps non-null element type', () => {
  expectTypeOf<StorageOutputTypes['waivedElementCheck']>().toEqualTypeOf<ReadonlyArray<string>>();
  expectTypeOf<StorageInputTypes['waivedElementCheck']>().toEqualTypeOf<ReadonlyArray<string>>();
});

test('scalar storage column is unaffected', () => {
  expectTypeOf<StorageOutputTypes['id']>().toEqualTypeOf<string>();
});

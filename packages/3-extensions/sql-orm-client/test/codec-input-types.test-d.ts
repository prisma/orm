import { expectTypeOf, test } from 'vitest';
import type { CreateInput, DefaultModelRow, MutationUpdateInput } from '../src/types';
import type { Contract, FieldInputTypes, FieldOutputTypes } from './fixtures/generated/contract';

type TagIdInput = FieldInputTypes['public']['Tag']['id'];
type TagIdOutput = FieldOutputTypes['public']['Tag']['id'];

test('reads keep the codec output type', () => {
  expectTypeOf<DefaultModelRow<Contract, 'Tag'>['id']>().toEqualTypeOf<TagIdOutput>();
});

test('create input uses the codec input type', () => {
  expectTypeOf<CreateInput<Contract, 'Tag'>['id']>().toEqualTypeOf<TagIdInput | undefined>();
});

test('update input uses the codec input type', () => {
  expectTypeOf<MutationUpdateInput<Contract, 'Tag'>['id']>().toEqualTypeOf<
    TagIdInput | undefined
  >();
});

test('the input and output types of a refined char column differ', () => {
  expectTypeOf<TagIdInput>().not.toEqualTypeOf<TagIdOutput>();
});

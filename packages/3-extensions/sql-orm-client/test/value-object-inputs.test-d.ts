import { expectTypeOf, test } from 'vitest';
import type { CreateInput, DefaultModelRow, MutationUpdateInput } from '../src/types';
import type { Contract } from './fixtures/value-objects/generated/contract';

type AddressShape = { readonly street: string; readonly city: string; readonly zip: string | null };

test('DefaultModelRow expands value object to inline structure', () => {
  type Row = DefaultModelRow<Contract, 'User'>;
  expectTypeOf<Row['address']>().toEqualTypeOf<AddressShape | null>();
});

test('CreateInput accepts inline value object structure', () => {
  type Input = CreateInput<Contract, 'User'>;
  expectTypeOf<Input['address']>().toEqualTypeOf<AddressShape | null | undefined>();
});

test('update input accepts wholesale value object replacement', () => {
  type UpdateInput = MutationUpdateInput<Contract, 'User'>;
  const input: UpdateInput = {
    address: { street: '456 Oak', city: 'LA', zip: null },
  };
  expectTypeOf(input).toExtend<UpdateInput>();
});

test('update input accepts null for nullable value object field', () => {
  type UpdateInput = MutationUpdateInput<Contract, 'User'>;
  const input: UpdateInput = { address: null };
  expectTypeOf(input).toExtend<UpdateInput>();
});

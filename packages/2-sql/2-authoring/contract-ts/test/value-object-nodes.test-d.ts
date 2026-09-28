import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { ValueObjectNode } from '../src/contract-definition';

type Member = ValueObjectNode['fields'][number];

test('a scalar value-object member needs no column', () => {
  expectTypeOf<{
    readonly fieldName: string;
    readonly descriptor: ColumnTypeDescriptor;
    readonly nullable: boolean;
  }>().toExtend<Member>();
});

test('no value-object member carries a column name', () => {
  expectTypeOf<Extract<Member, { readonly columnName: string }>>().toBeNever();
});

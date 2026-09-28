import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { FieldNode, MemberTypeDescriptor, ValueObjectNode } from '../src/contract-definition';

type Member = ValueObjectNode['fields'][number];

test('a scalar value-object member needs no column', () => {
  expectTypeOf<{
    readonly fieldName: string;
    readonly descriptor: { readonly codecId: string };
    readonly nullable: boolean;
  }>().toExtend<Member>();
});

test('no value-object member carries a column name', () => {
  expectTypeOf<Extract<Member, { readonly columnName: string }>>().toBeNever();
});

test('a member is typed by a codec and its type parameters only', () => {
  expectTypeOf<keyof MemberTypeDescriptor>().toEqualTypeOf<'codecId' | 'typeParams'>();
});

test('a model field is still typed by a full column descriptor', () => {
  expectTypeOf<FieldNode['descriptor']>().toEqualTypeOf<ColumnTypeDescriptor>();
});

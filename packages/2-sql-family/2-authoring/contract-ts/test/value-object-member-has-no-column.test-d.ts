import { expectTypeOf, test } from 'vitest';
import type { ScalarMemberNode, ValueObjectNode } from '../src/contract-definition';

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

test('a scalar member descriptor carries no storage part', () => {
  expectTypeOf<Extract<keyof ScalarMemberNode['descriptor'], 'valueSet'>>().toBeNever();
});

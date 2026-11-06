/**
 * Type-level proof that a generic list op resolves through the real expression
 * types: the element argument is tied to the list receiver's element codec, and
 * an element-preserving op echoes the element codec in its return.
 *
 * Pins the impl-signature layer only (not runtime `self` descriptor or ORM/table-proxy).
 */

import { expectTypeOf, test } from 'vitest';
import type { CodecExpression, Expression } from '../src/expression';

// Minimal fake CodecTypes — input/output/traits, the slots the real types read.
type CT = {
  'pg/int4@1': { input: number; output: number; traits: readonly ['equality', 'order'] };
  'pg/text@1': { input: string; output: string; traits: readonly ['equality', 'textual'] };
  'pg/bool@1': { input: boolean; output: boolean; traits: readonly ['equality'] };
};

// A list-typed expression: an Expression whose returnType carries `many: true`.
type ListExpression<CodecId extends string, Nullable extends boolean> = Expression<{
  codecId: CodecId;
  nullable: Nullable;
  many: true;
}>;

// Generic list op: element argument tied to the list's element codec id.
declare function indexOf<CodecId extends keyof CT & string>(
  self: ListExpression<CodecId, false>,
  elem: CodecExpression<CodecId, false, CT>,
): Expression<{ codecId: 'pg/int4@1'; nullable: false }>;

// Element-preserving op: return echoes the element codec as a list.
declare function append<CodecId extends keyof CT & string>(
  self: ListExpression<CodecId, false>,
  elem: CodecExpression<CodecId, false, CT>,
): ListExpression<CodecId, false>;

declare const intList: ListExpression<'pg/int4@1', false>;
declare const textList: ListExpression<'pg/text@1', false>;
declare const intExpr: Expression<{ codecId: 'pg/int4@1'; nullable: false }>;

test('indexOf infers the element codec from the list receiver', () => {
  // raw value of the element's input type
  expectTypeOf(indexOf(intList, 5)).toEqualTypeOf<
    Expression<{ codecId: 'pg/int4@1'; nullable: false }>
  >();
  // a matching element expression
  indexOf(intList, intExpr);
  // text list takes a string element
  indexOf(textList, 'hello');
});

test('indexOf rejects an element of the wrong type', () => {
  // @ts-expect-error -- elem must be int4 (number / int expr), not a string
  indexOf(intList, 'nope');
  // @ts-expect-error -- elem must be text, not a number
  indexOf(textList, 5);
});

test('append preserves the element codec in its return', () => {
  expectTypeOf(append(intList, 5)).toEqualTypeOf<ListExpression<'pg/int4@1', false>>();
});

// `CodecExpression` carries `many?: never`, so a scalar slot rejects a list
// expression while scalar expressions (no `many` key) pass unchanged.
declare function scalarEq<CodecId extends keyof CT & string>(
  a: CodecExpression<CodecId, false, CT>,
  b: CodecExpression<CodecId, false, CT>,
): Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

test('a list expression is rejected by a scalar CodecExpression slot', () => {
  scalarEq(intExpr, 5); // scalar expr + raw value: fine
  // @ts-expect-error -- list expression (many: true) not assignable to a `many?: never` scalar slot
  scalarEq(intExpr, intList);
});

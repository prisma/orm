/**
 * Type-level proof that `X` and `X[]` stay distinct at the operand slot WITHOUT
 * stamping `many: false` on scalar expression or scope types.
 *
 * The discriminant lives on the operand slot (`CodecExpression` carries
 * `many?: never`) rather than on scalar values. Scalar expressions stay
 * `{codecId, nullable}` — no `many` key — while only the slot type changes.
 */

import { expectTypeOf, test } from 'vitest';
import type { Expression } from '../src/expression';

// Scalar expressions exactly as the FieldProxy / StorageTableToScopeTable
// produce them — NO `many` key, NOT `many: false`.
type ScalarExpr<CodecId extends string, N extends boolean> = Expression<{
  codecId: CodecId;
  nullable: N;
}>;

// List expression (the conditional scope propagation adds `many: true`).
type ListExpr<CodecId extends string, N extends boolean> = Expression<{
  codecId: CodecId;
  nullable: N;
  many: true;
}>;

// Operand slot: discriminant lives HERE (`many?: never`), not on scalar value types.
// This is the shape carried by `CodecExpression`.
type ScalarSlot<CodecId extends string, N extends boolean> = Expression<{
  codecId: CodecId;
  nullable: N;
  many?: never;
}>;

declare const sName: ScalarExpr<'pg/text@1', false>;
declare const lTags: ListExpr<'pg/text@1', false>;

declare function scalarEq<CodecId extends string>(
  a: ScalarSlot<CodecId, false>,
  b: ScalarSlot<CodecId, false>,
): Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

declare function listEq<CodecId extends string>(
  a: ListExpr<CodecId, false>,
  b: ListExpr<CodecId, false>,
): Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

test('scalar expression (no `many` key) is accepted by the scalar slot', () => {
  scalarEq(sName, sName);
});

test('list expression is rejected by the scalar slot (no `many: false` needed on scalars)', () => {
  // @ts-expect-error -- {many: true} is not assignable to a slot whose `many?: never`
  scalarEq(lTags, lTags);
  // @ts-expect-error -- mixed: list in the second operand
  scalarEq(sName, lTags);
});

test('list expression is accepted by the list slot; scalar is rejected there', () => {
  listEq(lTags, lTags);
  // @ts-expect-error -- scalar (no `many`) not assignable to a slot requiring `many: true`
  listEq(sName, sName);
});

test('the assignability direction is what makes it work', () => {
  // scalar returnType is assignable to the `many?: never` slot's returnType
  expectTypeOf<{ codecId: 'pg/text@1'; nullable: false }>().toExtend<{
    codecId: 'pg/text@1';
    nullable: false;
    many?: never;
  }>();
  // list returnType is NOT (true is not assignable to never)
  expectTypeOf<{ codecId: 'pg/text@1'; nullable: false; many: true }>().not.toExtend<{
    codecId: 'pg/text@1';
    nullable: false;
    many?: never;
  }>();
});

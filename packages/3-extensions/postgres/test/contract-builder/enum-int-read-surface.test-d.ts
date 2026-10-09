// Int-backed enum read surface — end-to-end type-level proof.
//
// Background: enum value lowering now encodes through the codec and the
// contract IR widened enum values from `string` to `JsonValue`, so an
// int-backed `member('Low', 1)` keeps the number `1`. That widening could
// silently widen the *inferred read type* of an int-enum field from a literal
// union (`1 | 10`) to `number` or `JsonValue`. Runtime `.toEqual([1, 10])`
// tests cannot catch that, so this is a type-level proof.
//
// Harness shape (A), fully end-to-end: a real inline `defineContract` int-enum
// contract is fed to `DefaultModelRow` / `CreateInput` from the ORM lane. This
// proves authoring → typemap → read for an int enum. The postgres package
// depends on sql-orm-client, so both the postgres-bound `defineContract` /
// `enumType` (within-package, via `../../src/...`) and the ORM read/write row
// types (cross-package, via `@internal/sql-orm-client`) are importable here.
//
// The int enum is built ONLY inline here — never added to an emitted/fixture
// contract — because numeric enums cannot be rendered as CHECK predicates.
// This file is type-checked, not executed, so the `defineContract` call below
// never runs and the guard never fires here. Against the real Postgres pack it
// DOES fire: authoring an int-backed enum throws `CONTRACT.ENUM_INVALID` at
// build time, which `enum-int-authoring.test.ts` pins at runtime.

import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { JsonValue } from '@internal/contract/types';
import type { CreateInput, DefaultModelRow } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';

const pgInt = { codecId: 'pg/int4@1' } as const;

const Level = enumType('Level', pgInt, member('Low', 1), member('High', 10));

const contract = defineContract({ enums: { Level } }, ({ field, model }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.id.uuidv4String(),
        level: field.namedType(Level),
      },
    }),
  },
}));

type EventRow = DefaultModelRow<typeof contract, 'Event'>;
type EventCreate = CreateInput<typeof contract, 'Event'>;

// ---------------------------------------------------------------------------
// 1. Read row type narrows the int-enum field to the numeric literal union.
// ---------------------------------------------------------------------------

test('int-enum read field narrows to the numeric literal union', () => {
  expectTypeOf<EventRow['level']>().toEqualTypeOf<1 | 10>();
});

test('int-enum read field is not widened to bare number', () => {
  expectTypeOf<EventRow['level']>().not.toEqualTypeOf<number>();
});

test('int-enum read field is not widened to JsonValue', () => {
  expectTypeOf<EventRow['level']>().not.toEqualTypeOf<JsonValue>();
});

// ---------------------------------------------------------------------------
// 2. db.enums.<ns> accessor keeps the literal int tuple.
// ---------------------------------------------------------------------------

type Enums = NamespacedEnums<typeof contract>;
type PublicEnums = Enums['public'];
type LevelValues = PublicEnums extends { Level: { values: infer V } } ? V : never;

test('db.enums.<ns> int tuple keeps its literal declaration order', () => {
  expectTypeOf<LevelValues>().toEqualTypeOf<readonly [1, 10]>();
});

test('db.enums.<ns> int tuple is not widened to readonly number[]', () => {
  expectTypeOf<LevelValues>().not.toEqualTypeOf<readonly number[]>();
});

// ---------------------------------------------------------------------------
// 3. Write input accepts in-union ints and rejects out-of-union / wrong type.
// ---------------------------------------------------------------------------

test('int-enum write input accepts the numeric literal union', () => {
  expectTypeOf<EventCreate['level']>().toEqualTypeOf<1 | 10>();
});

test('int-enum write input rejects out-of-union and wrong-typed values', () => {
  const inUnion: EventCreate['level'] = 10;
  void inUnion;

  // @ts-expect-error 2 is not a Level member value.
  const outOfUnion: EventCreate['level'] = 2;
  // @ts-expect-error '1' is a string, not the int member value 1.
  const wrongType: EventCreate['level'] = '1';

  void outOfUnion;
  void wrongType;
});

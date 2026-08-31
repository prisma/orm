/**
 * Type-level coverage for the ORM-client async-codec boundary.
 *
 * These assertions encode the invariant that ORM-client read and write surfaces always present plain `T` values to consumers — never `Promise<T>` or `T | Promise<T>` — even though codec query-time methods (`encode` / `decode`) are Promise-returning at the boundary. The Promise lift lives inside `sql-runtime`'s decode-once-per-row contract; the orm-client itself never adds (or removes) a Promise wrapper, so the
 * type-level surfaces here stay plain by construction.
 *
 * Coverage:
 * - **Row shape**: `DefaultModelRow` / `InferRootRow` carry plain `T` for both `.first()` and `for await` consumption paths.
 * - **Write surfaces**: `CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, and `ShorthandWhereFilter` carry plain `T` for field positions.
 * - **Negative tests**: no `Promise<T>` form leaks into a row-shape position (read or write). The ORM client uses one field type-map (rooted in `DefaultModelRow`); there is no read/write split for codec output types.
 */

import { expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type {
  CreateInput,
  DefaultModelRow,
  InferRootRow,
  MutationUpdateInput,
  ShorthandWhereFilter,
  UniqueConstraintCriterion,
} from '../src/types';
import type { Contract } from './fixtures/generated/contract';

// `User.address` is jsonb-backed (a value object whose fields and the field itself flow through the `pg/jsonb@1` codec); `User.invitedById` is int4 and nullable. Both codecs are lifted to async dispatch at the codec boundary regardless of whether the author wrote sync or async functions, so these columns are representative of "async codec columns" at the runtime boundary.
//
// See `packages/1-framework/1-core/framework-components/src/shared/codec.ts` (`Codec` interface — `encode`/`decode` return `Promise<…>`) — every author function is wrapped at the class boundary, which means every column is an "async codec" at the runtime layer.

type AddressShape = {
  readonly street: string;
  readonly city: string;
  readonly zip: string | null;
};

type IsPromiseLike<T> = T extends Promise<unknown> ? true : false;

type UserRow = DefaultModelRow<Contract, 'User'>;
type UserCreate = CreateInput<Contract, 'User'>;
type UserUpdate = MutationUpdateInput<Contract, 'User'>;
type UserUnique = UniqueConstraintCriterion<Contract, 'User'>;
type UserWhere = ShorthandWhereFilter<Contract, 'public', 'User'>;
type UserInferRoot = InferRootRow<Contract, 'User'>;

test('DefaultModelRow exposes plain `string` for pg/text@1 columns', () => {
  expectTypeOf<UserRow['name']>().toEqualTypeOf<string>();
  expectTypeOf<UserRow['email']>().toEqualTypeOf<string>();
});

test('DefaultModelRow exposes plain `number` for pg/int4@1 columns', () => {
  expectTypeOf<UserRow['id']>().toEqualTypeOf<number>();
});

test('DefaultModelRow exposes plain `T | null` for nullable pg/int4@1 columns', () => {
  expectTypeOf<UserRow['invitedById']>().toEqualTypeOf<number | null>();
});

test('DefaultModelRow exposes plain object value (no Promise) for jsonb-backed value object', () => {
  expectTypeOf<UserRow['address']>().toEqualTypeOf<AddressShape | null>();
});

test('InferRootRow for non-polymorphic model equals DefaultModelRow', () => {
  type RootRow = InferRootRow<Contract, 'User'>;
  expectTypeOf<RootRow>().toEqualTypeOf<UserRow>();
});

type UserCollectionRow<C extends { all(): unknown }> = C['all'] extends () => AsyncIterable<infer R>
  ? R
  : never;

test('Collection.first() resolves to a plain row | null (no Promise<T> on row fields)', () => {
  type UserCollection = Collection<Contract, 'User'>;
  type FirstResult = UserCollection extends { first(): infer R } ? R : never;
  type FirstAwaited = Awaited<FirstResult>;
  type Row = Exclude<FirstAwaited, null>;
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<Row['address']>().toEqualTypeOf<AddressShape | null>();
  expectTypeOf<IsPromiseLike<Row['name']>>().toEqualTypeOf<false>();
});

test('Collection async iteration yields a plain row (no Promise<T> on row fields)', () => {
  type UserCollection = Collection<Contract, 'User'>;
  type IteratedRow = UserCollectionRow<UserCollection>;
  expectTypeOf<IteratedRow['name']>().toEqualTypeOf<string>();
  expectTypeOf<IteratedRow['id']>().toEqualTypeOf<number>();
  expectTypeOf<IteratedRow['address']>().toEqualTypeOf<AddressShape | null>();
  expectTypeOf<IsPromiseLike<IteratedRow['name']>>().toEqualTypeOf<false>();
});

test('Collection.all().firstOrThrow() resolves to a plain row (no Promise<T> on row fields)', () => {
  type UserCollection = Collection<Contract, 'User'>;
  type AllReturn = UserCollection extends { all(): infer R } ? R : never;
  type FirstThrowResult = AllReturn extends { firstOrThrow(): infer R } ? R : never;
  type Row = Awaited<FirstThrowResult>;
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
  expectTypeOf<Row['id']>().toEqualTypeOf<number>();
  expectTypeOf<IsPromiseLike<Row['name']>>().toEqualTypeOf<false>();
});

test('CreateInput accepts plain `string` for pg/text@1 fields', () => {
  expectTypeOf<UserCreate['name']>().toEqualTypeOf<string>();
  expectTypeOf<UserCreate['email']>().toEqualTypeOf<string>();
});

test('CreateInput accepts plain object for jsonb-backed value-object field', () => {
  expectTypeOf<UserCreate['address']>().toEqualTypeOf<AddressShape | null | undefined>();
});

test('MutationUpdateInput accepts plain T for jsonb-backed value-object field', () => {
  expectTypeOf<UserUpdate['address']>().toEqualTypeOf<AddressShape | null | undefined>();
});

test('MutationUpdateInput accepts plain `string` for pg/text@1 fields', () => {
  expectTypeOf<UserUpdate['name']>().toEqualTypeOf<string | undefined>();
});

test('UniqueConstraintCriterion variants carry plain T for unique columns', () => {
  // User has unique(id) [PK] and unique(email). Use toExtend to keep the assertion robust against minor representation differences (e.g. readonly modifiers / discriminated arrangement) while still pinning the field types to plain T.
  expectTypeOf<UserUnique>().toExtend<{ readonly id: number } | { readonly email: string }>();
  expectTypeOf<{ readonly id: number }>().toExtend<UserUnique>();
  expectTypeOf<{ readonly email: string }>().toExtend<UserUnique>();
});

test('ShorthandWhereFilter accepts plain T (or null/undefined) for filterable fields', () => {
  expectTypeOf<UserWhere['name']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<UserWhere['email']>().toEqualTypeOf<string | null | undefined>();
  expectTypeOf<UserWhere['id']>().toEqualTypeOf<number | null | undefined>();
});

test('no DefaultModelRow field position resolves to a Promise<T>', () => {
  expectTypeOf<IsPromiseLike<UserRow['name']>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<UserRow['id']>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<UserRow['invitedById']>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<NonNullable<UserRow['address']>>>().toEqualTypeOf<false>();
});

test('no InferRootRow field position resolves to a Promise<T>', () => {
  expectTypeOf<IsPromiseLike<UserInferRoot['name']>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<UserInferRoot['id']>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<UserInferRoot['invitedById']>>().toEqualTypeOf<false>();
});

test('no CreateInput field position resolves to a Promise<T>', () => {
  expectTypeOf<IsPromiseLike<NonNullable<UserCreate['name']>>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<NonNullable<UserCreate['email']>>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<NonNullable<UserCreate['address']>>>().toEqualTypeOf<false>();
});

test('no MutationUpdateInput field position resolves to a Promise<T>', () => {
  expectTypeOf<IsPromiseLike<NonNullable<UserUpdate['name']>>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<NonNullable<UserUpdate['email']>>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<NonNullable<UserUpdate['address']>>>().toEqualTypeOf<false>();
});

test('no ShorthandWhereFilter field position resolves to a Promise<T>', () => {
  expectTypeOf<IsPromiseLike<NonNullable<UserWhere['name']>>>().toEqualTypeOf<false>();
  expectTypeOf<IsPromiseLike<NonNullable<UserWhere['id']>>>().toEqualTypeOf<false>();
});

// One field type-map shared by read and write surfaces: `CreateInput` and `MutationUpdateInput` are both derived from `DefaultModelRow`, which means the field-type source of truth is identical for reads and writes. The assertions below pin the field types to a single shape so that any future drift (e.g. introducing a `DefaultModelInputRow` with `Promise<T>` shapes) would break this test.

test('CreateInput field types match DefaultModelRow field types (one type-map)', () => {
  expectTypeOf<NonNullable<UserCreate['name']>>().toEqualTypeOf<UserRow['name']>();
  expectTypeOf<NonNullable<UserCreate['email']>>().toEqualTypeOf<UserRow['email']>();
  expectTypeOf<UserCreate['address']>().toEqualTypeOf<UserRow['address'] | undefined>();
});

test('MutationUpdateInput field types match DefaultModelRow field types (one type-map)', () => {
  expectTypeOf<NonNullable<UserUpdate['name']>>().toEqualTypeOf<UserRow['name']>();
  expectTypeOf<NonNullable<UserUpdate['email']>>().toEqualTypeOf<UserRow['email']>();
  expectTypeOf<UserUpdate['address']>().toEqualTypeOf<UserRow['address'] | undefined>();
});

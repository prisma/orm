// The types the generated compatibility tests use; see api-compat.mjs. SkipUniqueSymbols and
// requireAssignableTo are from microsoft/FluidFramework build-tools (MIT), typeCompatibility.ts.
//
// The tests compare with TypeScript's own assignability first. These types are the fallbacks for
// a comparison it cannot make between two copies of one declaration, and every one is written
// twice, once per side: through a single alias TypeScript compares two instantiations by the
// alias's measured variance, which lets a narrowed method parameter pass.
//
// Erase<T> instantiates the generic signatures of T, and of T's members, with their constraints,
// and compares the rest natively.
//
// Structural<T> maps T recursively and keeps what a user of T relies on, dropping what makes two
// copies of one declaration differ: unique symbol keys, private members and brands on primitives.
// It keeps call and construct signatures and turns methods into function-typed properties, so that
// method parameters are compared contravariantly.

export type requireAssignableTo<_A extends B, B> = true;

export type IsNeverOrAny<T> = [T] extends [never] ? true : 0 extends 1 & T ? true : false;

type ValueOf<T> = T[keyof T];
type OnlySymbols<T> = T extends symbol ? T : never;
type WellKnownSymbols = OnlySymbols<ValueOf<typeof Symbol>>;
type SkipUniqueSymbols<Key> = symbol extends Key
  ? Key
  : Key extends symbol
    ? Key extends WellKnownSymbols
      ? Key
      : never
    : Key;

type Primitive = string | number | bigint | boolean | null | undefined;
type PrimitiveOf<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends bigint
      ? bigint
      : T extends boolean
        ? boolean
        : T;
type ExtraKeys<T> = Exclude<keyof T, keyof PrimitiveOf<T>>;
type WithoutBrand<T> = [ExtraKeys<T>] extends [never] ? T : PrimitiveOf<T>;

type MembersOld<T> = { [K in keyof T as SkipUniqueSymbols<K>]: StructuralOld<T[K]> };
type CallOld<T> = T extends (...args: infer A) => infer R
  ? (...args: { [K in keyof A]: StructuralOld<A[K]> }) => StructuralOld<R>
  : unknown;
type ConstructOld<T> = T extends new (
  ...args: infer A
) => infer R
  ? new (
      ...args: { [K in keyof A]: StructuralOld<A[K]> }
    ) => StructuralOld<R>
  : T extends abstract new (
        ...args: infer A
      ) => infer R
    ? abstract new (
        ...args: { [K in keyof A]: StructuralOld<A[K]> }
      ) => StructuralOld<R>
    : unknown;
export type StructuralOld<T> = T extends Primitive
  ? WithoutBrand<T>
  : T extends symbol
    ? SkipUniqueSymbols<T>
    : T extends readonly unknown[]
      ? { [K in keyof T]: StructuralOld<T[K]> }
      : CallOld<T> & ConstructOld<T> & MembersOld<T>;

type MembersNew<T> = { [K in keyof T as SkipUniqueSymbols<K>]: StructuralNew<T[K]> };
type CallNew<T> = T extends (...args: infer A) => infer R
  ? (...args: { [K in keyof A]: StructuralNew<A[K]> }) => StructuralNew<R>
  : unknown;
type ConstructNew<T> = T extends new (
  ...args: infer A
) => infer R
  ? new (
      ...args: { [K in keyof A]: StructuralNew<A[K]> }
    ) => StructuralNew<R>
  : T extends abstract new (
        ...args: infer A
      ) => infer R
    ? abstract new (
        ...args: { [K in keyof A]: StructuralNew<A[K]> }
      ) => StructuralNew<R>
    : unknown;
export type StructuralNew<T> = T extends Primitive
  ? WithoutBrand<T>
  : T extends symbol
    ? SkipUniqueSymbols<T>
    : T extends readonly unknown[]
      ? { [K in keyof T]: StructuralNew<T[K]> }
      : CallNew<T> & ConstructNew<T> & MembersNew<T>;

type EraseCallOld<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : unknown;
type EraseConstructOld<T> = T extends new (
  ...args: infer A
) => infer R
  ? new (
      ...args: A
    ) => R
  : T extends abstract new (
        ...args: infer A
      ) => infer R
    ? abstract new (
        ...args: A
      ) => R
    : unknown;
type EraseMemberOld<T> = [T] extends [(...args: never) => unknown] ? EraseCallOld<T> : T;
export type EraseOld<T> = EraseCallOld<T> &
  EraseConstructOld<T> & { [K in keyof T]: EraseMemberOld<T[K]> };

type EraseCallNew<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : unknown;
type EraseConstructNew<T> = T extends new (
  ...args: infer A
) => infer R
  ? new (
      ...args: A
    ) => R
  : T extends abstract new (
        ...args: infer A
      ) => infer R
    ? abstract new (
        ...args: A
      ) => R
    : unknown;
type EraseMemberNew<T> = [T] extends [(...args: never) => unknown] ? EraseCallNew<T> : T;
export type EraseNew<T> = EraseCallNew<T> &
  EraseConstructNew<T> & { [K in keyof T]: EraseMemberNew<T[K]> };

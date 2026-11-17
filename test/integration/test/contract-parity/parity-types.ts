/// <reference types="temporal-polyfill/types/global" />
import type { contract as postgresScalarSource } from '../planner-golden/fixtures/postgres/contract';
import type { Contract as PostgresScalarEmitted } from '../planner-golden/fixtures/postgres/generated/contract';
import type { contract as sqliteScalarSource } from '../planner-golden/fixtures/sqlite/contract';
import type { Contract as SqliteScalarEmitted } from '../planner-golden/fixtures/sqlite/generated/contract';
import type { contract as fullTextSource } from '../sql-builder/fixtures/contract';
import type { contract as relationsSource } from '../sql-builder/fixtures/contract-no-pgvector';
import type { Contract as FullTextEmitted } from '../sql-builder/fixtures/generated/contract';
import type { Contract as RelationsEmitted } from '../sql-builder/fixtures/generated-no-pgvector/contract';
import type { contract as postgresParitySource } from './fixtures/postgres/contract';
import type { Contract as PostgresParityEmitted } from './fixtures/postgres/generated/contract';
import type { contract as sqliteParitySource } from './fixtures/sqlite/contract';
import type { Contract as SqliteParityEmitted } from './fixtures/sqlite/generated/contract';

/** Each parity fixture: the contract written with `defineContract`, and the `contract.d.ts` emitted from it. */
export type Fixtures = {
  readonly postgresScalar: readonly [typeof postgresScalarSource, PostgresScalarEmitted];
  readonly sqliteScalar: readonly [typeof sqliteScalarSource, SqliteScalarEmitted];
  readonly relations: readonly [typeof relationsSource, RelationsEmitted];
  readonly fullText: readonly [typeof fullTextSource, FullTextEmitted];
  readonly postgresParity: readonly [typeof postgresParitySource, PostgresParityEmitted];
  readonly sqliteParity: readonly [typeof sqliteParitySource, SqliteParityEmitted];
};

export type Built<F extends keyof Fixtures> = Fixtures[F][0];
export type Emitted<F extends keyof Fixtures> = Fixtures[F][1];

type IsAny<T> = 0 extends 1 & T ? true : false;

// `any` is assignable both ways, so a leaf counts as equal only when both sides are `any` or neither is.
type MutuallyAssignable<A, B> =
  IsAny<A> extends IsAny<B> ? ([A] extends [B] ? ([B] extends [A] ? true : false) : false) : false;

type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;

// A single object type, not an array, a function or a union, whose properties can be compared one by one.
type IsPlainObject<T> =
  true extends IsUnion<T>
    ? false
    : [T] extends [readonly unknown[]]
      ? false
      : [T] extends [(...args: never[]) => unknown]
        ? false
        : [T] extends [object]
          ? true
          : false;

/**
 * Whether two types are mutually assignable, compared key by key down `Levels` levels of objects. TypeScript relates two instantiations of one generic type alias by their type arguments, using the variance it measured for the alias; for an alias built from conditional types that measurement can let any two instantiations pass. Reading the properties first makes the comparison structural.
 */
export type SameType<
  A,
  B,
  Levels extends number = 1,
  Depth extends readonly unknown[] = [],
> = Depth['length'] extends Levels
  ? MutuallyAssignable<A, B>
  : [IsPlainObject<A>, IsPlainObject<B>] extends [true, true]
    ? MutuallyAssignable<keyof A, keyof B> extends true
      ? false extends {
          [K in keyof A]: K extends keyof B
            ? SameType<A[K], B[K], Levels, readonly [...Depth, 0]>
            : false;
        }[keyof A]
        ? false
        : true
      : false
    : MutuallyAssignable<A, B>;

/** The keys whose values differ between two maps, or that only one has; `never` when they agree. */
export type DifferingKeys<A, B> = {
  [K in keyof A | keyof B]: K extends keyof A
    ? K extends keyof B
      ? SameType<A[K], B[K]> extends true
        ? never
        : K
      : K
    : K;
}[keyof A | keyof B];

/** `'<outer>.<inner>'` for each entry of a two-level map that differs; `never` when they agree. */
export type DifferingPaths<A, B> = {
  [K in (keyof A | keyof B) & string]: K extends keyof A
    ? K extends keyof B
      ? `${K}.${DifferingKeys<A[K], B[K]> & string}`
      : K
    : K;
}[(keyof A | keyof B) & string];

/** The keys of `Shape` that are neither compared nor excluded; `never` when every key is classified. */
export type UnclassifiedKeys<Shape, Compared extends PropertyKey, Excluded> = Exclude<
  keyof Shape,
  Compared | keyof Excluded
>;

export type NamespaceMaps<Map> = Map[keyof Map];

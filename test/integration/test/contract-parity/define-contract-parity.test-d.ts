import type { ExtractTypeMapsFromContract, TypeMaps } from '@internal/sql-contract/types';
import { describe, expectTypeOf, test } from 'vitest';
import type { DifferingKeys, DifferingPaths, Fixtures, UnclassifiedKeys } from './parity-types';

type Maps<F extends keyof Fixtures, Side extends 0 | 1> = ExtractTypeMapsFromContract<
  Fixtures[F][Side]
>;

type PublicCodecTypes<CodecTypes> = {
  readonly [CodecId in keyof CodecTypes]: Pick<
    CodecTypes[CodecId],
    Extract<keyof CodecTypes[CodecId], 'input' | 'output' | 'traits'>
  >;
};

/** `'<namespace>.<model or table>.<field or column>'` for each entry that differs. */
type NamespacedDifferingPaths<A, B> = {
  [Ns in (keyof A | keyof B) & string]: Ns extends keyof A
    ? Ns extends keyof B
      ? `${Ns}.${DifferingPaths<A[Ns], B[Ns]> & string}`
      : `${Ns} (built only)`
    : `${Ns} (emitted only)`;
}[(keyof A | keyof B) & string];

/** For each fixture, `'<fixture>: <path>'` for every entry of the type map `Key` that differs. */
type FixtureDifferences<Key extends keyof TypeMaps, Compare extends 'keys' | 'namespaced'> = {
  [F in keyof Fixtures]: `${F}: ${(Compare extends 'keys'
    ? DifferingKeys<Normalize<Key, Maps<F, 0>[Key]>, Normalize<Key, Maps<F, 1>[Key]>>
    : NamespacedDifferingPaths<Maps<F, 0>[Key], Maps<F, 1>[Key]>) &
    string}`;
}[keyof Fixtures];

// The emitted codec types carry a `json` slot that only the emitted `contract.d.ts` helper types read. The emitter writes an empty map of query operations as `Record<string, never>`, and the built contract gives `{}`.
type Normalize<Key extends keyof TypeMaps, Map> = Key extends 'codecTypes'
  ? PublicCodecTypes<Map>
  : string extends keyof Map
    ? Record<never, never>
    : Map;

type Differences<
  Key extends keyof TypeMaps,
  Compare extends 'keys' | 'namespaced',
> = FixtureDifferences<Key, Compare>;

describe('every type map of a defineContract contract equals the emitted one', () => {
  test('every type map is compared', () => {
    type Compared =
      | 'codecTypes'
      | 'queryOperationTypes'
      | 'aggregateTypes'
      | 'fieldOutputTypes'
      | 'fieldInputTypes'
      | 'storageColumnTypes'
      | 'storageColumnInputTypes';
    expectTypeOf<UnclassifiedKeys<TypeMaps, Compared, Record<never, never>>>().toBeNever();
  });

  test('the compared maps hold the operations, so the comparison sees them', () => {
    expectTypeOf<'fullTextMatches'>().toExtend<keyof Maps<'fullText', 0>['queryOperationTypes']>();
    expectTypeOf<'fullTextMatches'>().toExtend<keyof Maps<'fullText', 1>['queryOperationTypes']>();
  });

  test('codec types', () => {
    expectTypeOf<Differences<'codecTypes', 'keys'>>().toBeNever();
  });

  test('query operation types', () => {
    expectTypeOf<Differences<'queryOperationTypes', 'keys'>>().toBeNever();
  });

  test('aggregate types', () => {
    expectTypeOf<Differences<'aggregateTypes', 'keys'>>().toBeNever();
  });

  test('field output types', () => {
    expectTypeOf<Differences<'fieldOutputTypes', 'namespaced'>>().toBeNever();
  });

  test('field input types', () => {
    expectTypeOf<Differences<'fieldInputTypes', 'namespaced'>>().toBeNever();
  });

  test('storage column output types', () => {
    expectTypeOf<Differences<'storageColumnTypes', 'namespaced'>>().toBeNever();
  });

  test('storage column input types', () => {
    expectTypeOf<Differences<'storageColumnInputTypes', 'namespaced'>>().toBeNever();
  });
});

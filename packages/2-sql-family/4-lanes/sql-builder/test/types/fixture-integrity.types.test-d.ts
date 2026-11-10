/**
 * Type-test: the fixture's codec map is a real map.
 *
 * An emitted contract importing a type its consuming package cannot resolve
 * degrades to `any` under `skipLibCheck`, and `any` satisfies every assertion
 * — so a whole suite of codec-resolved type tests can pass while checking
 * nothing. This guard fails loudly if that ever happens again here.
 */

import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes, Contract } from '../fixtures/generated/contract';

test('the fixture codec map is not any', () => {
  expectTypeOf<CodecTypes>().not.toBeAny();
  expectTypeOf<ExtractCodecTypes<Contract>>().not.toBeAny();
});

test('the fixture codec map carries the ids the type tests name', () => {
  expectTypeOf<CodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();
  expectTypeOf<CodecTypes['pg/text@1']['output']>().toEqualTypeOf<string>();
  expectTypeOf<CodecTypes['pg/int8@1']['output']>().toEqualTypeOf<bigint>();
});

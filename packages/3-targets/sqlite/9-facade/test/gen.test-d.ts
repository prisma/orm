import { expectTypeOf, test } from 'vitest';
import { gen } from '../src/exports/contract-builder';

test('gen holds exactly the generator functions the family and target declare', () => {
  expectTypeOf<keyof typeof gen>().toEqualTypeOf<
    'cuid' | 'ksuid' | 'nanoid' | 'now' | 'ulid' | 'uuid'
  >();
  expectTypeOf(gen.now).parameters.toEqualTypeOf<[]>();
  // @ts-expect-error now takes no argument
  gen.now(1);
});

test('gen types each argument by the signature of its function', () => {
  expectTypeOf(gen.uuid).parameters.toEqualTypeOf<[version?: 4 | 7]>();
  expectTypeOf(gen.cuid).parameters.toEqualTypeOf<[version: 2]>();
  expectTypeOf(gen.nanoid).parameters.toEqualTypeOf<[size?: number]>();
  expectTypeOf(gen.ulid).parameters.toEqualTypeOf<[]>();
  expectTypeOf(gen.ksuid).parameters.toEqualTypeOf<[]>();
  // @ts-expect-error uuid takes version 4 or 7
  gen.uuid(5);
  // @ts-expect-error cuid takes version 2
  gen.cuid(1);
  // @ts-expect-error nanoid takes a number
  gen.nanoid('16');
});

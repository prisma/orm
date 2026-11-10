import { expectTypeOf, test } from 'vitest';
import { gen } from '../src/exports/contract-builder';

test('gen holds exactly the generator functions the family and target declare', () => {
  expectTypeOf<keyof typeof gen>().toEqualTypeOf<'now'>();
  expectTypeOf(gen.now).parameters.toEqualTypeOf<[]>();
  // @ts-expect-error now takes no argument
  gen.now(1);
});

test('gen has no identifier functions, which MongoDB does not declare', () => {
  // @ts-expect-error MongoDB declares no uuid function
  gen.uuid();
});

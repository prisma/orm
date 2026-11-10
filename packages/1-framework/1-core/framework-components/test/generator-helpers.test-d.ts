import { expectTypeOf, test } from 'vitest';
import type { GeneratorFunctionCall } from '../src/shared/generator-functions';
import { createGeneratorHelpers } from '../src/shared/generator-helpers';

declare const version: { readonly _out?: 4 | 7; readonly optional: true };
declare const size: { readonly _out?: number };

const family = {
  generatorFunctions: [
    {
      name: 'uuid',
      signature: { documentation: 'uuid', positional: [{ key: 'version', type: version }] },
      bindings: [],
    },
    {
      name: 'nanoid',
      signature: { documentation: 'nanoid', positional: [{ key: 'size', type: size }] },
      bindings: [],
    },
  ],
} as const;
const mongo = {
  generatorFunctions: [{ name: 'now', signature: { documentation: 'now' }, bindings: [] }],
} as const;

test('a helper takes the argument types of its signature', () => {
  const gen = createGeneratorHelpers([family]);
  expectTypeOf(gen.uuid).parameters.toEqualTypeOf<[argument?: 4 | 7]>();
  expectTypeOf(gen.nanoid).parameters.toEqualTypeOf<[argument: number]>();
  expectTypeOf(gen.uuid()).toEqualTypeOf<GeneratorFunctionCall>();
  // @ts-expect-error uuid takes version 4 or 7
  gen.uuid(5);
});

test('a stack gets only the functions its components declare', () => {
  const gen = createGeneratorHelpers([mongo]);
  expectTypeOf(gen).toHaveProperty('now');
  // @ts-expect-error Mongo declares no uuid
  gen.uuid();
});

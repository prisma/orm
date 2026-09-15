import { expectTypeOf, test } from 'vitest';
import { defineTestCodec } from './test-codec';

test('factory lifts sync encode and preserves sync decode', () => {
  const c = defineTestCodec({
    typeId: 'demo/sync@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf(c.decode).toBeFunction();
  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toEqualTypeOf<string>();
});

test('factory rejects async decode', () => {
  defineTestCodec<'demo/async-decode@1', readonly [], string, string>({
    typeId: 'demo/async-decode@1',
    encode: (value: string) => value,
    // @ts-expect-error decode must return the input value synchronously.
    decode: async (wire: string) => wire,
  });
});

test('factory accepts mixed async encode + sync decode', () => {
  const c = defineTestCodec({
    typeId: 'demo/mixed-b@1',
    encode: async (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toEqualTypeOf<string>();
});

test('factory rejects an omitted encode — the property is required', () => {
  // @ts-expect-error encode is required at the defineTestCodec() factory call site; the factory installs no identity fallback.
  defineTestCodec({
    typeId: 'demo/no-encode@1',
    targetTypes: ['text'],
    decode: (wire: string) => wire,
  });
});

test('factory passes encodeJson and decodeJson through as synchronous', () => {
  const c = defineTestCodec({
    typeId: 'demo/json@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
    encodeJson: (value: string) => value,
    decodeJson: (json) => json as string,
  });

  expectTypeOf<ReturnType<typeof c.encodeJson>>().not.toExtend<Promise<unknown>>();
  expectTypeOf<ReturnType<typeof c.decodeJson>>().not.toExtend<Promise<unknown>>();
});

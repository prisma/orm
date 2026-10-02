import { expectTypeOf, test } from 'vitest';
import { defineTestCodec } from './test-codec';

test('factory accepts sync encode and decode and produces Promise-returning methods', () => {
  const c = defineTestCodec({
    typeId: 'demo/sync@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf(c.decode).toBeFunction();
  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory accepts async encode and decode', () => {
  const c = defineTestCodec({
    typeId: 'demo/async@1',
    encode: async (value: string) => value,
    decode: async (wire: string) => wire,
  });

  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory accepts mixed sync encode + async decode', () => {
  const c = defineTestCodec({
    typeId: 'demo/mixed-a@1',
    encode: (value: string) => value,
    decode: async (wire: string) => wire,
  });

  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory accepts mixed async encode + sync decode', () => {
  const c = defineTestCodec({
    typeId: 'demo/mixed-b@1',
    encode: async (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf<ReturnType<NonNullable<typeof c.encode>>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.decode>>().toExtend<Promise<string>>();
});

test('factory rejects an omitted encode — the property is required', () => {
  // @ts-expect-error encode is required at the defineTestCodec() factory call site; the factory installs no identity fallback.
  defineTestCodec({
    typeId: 'demo/no-encode@1',
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

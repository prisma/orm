import { expectTypeOf, test } from 'vitest';
import { defineTestCodec } from './test-codec';

test('factory accepts sync toWire and fromWire and produces Promise-returning methods', () => {
  const c = defineTestCodec({
    typeId: 'demo/sync@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => wire,
  });

  expectTypeOf(c.toWire).toBeFunction();
  expectTypeOf(c.fromWire).toBeFunction();
  expectTypeOf<ReturnType<typeof c.toWire>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.fromWire>>().toExtend<Promise<string>>();
});

test('factory accepts async toWire and fromWire', () => {
  const c = defineTestCodec({
    typeId: 'demo/async@1',
    toWire: async (value: string) => value,
    fromWire: async (wire: string) => wire,
  });

  expectTypeOf<ReturnType<typeof c.toWire>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.fromWire>>().toExtend<Promise<string>>();
});

test('factory accepts mixed sync toWire + async fromWire', () => {
  const c = defineTestCodec({
    typeId: 'demo/mixed-a@1',
    toWire: (value: string) => value,
    fromWire: async (wire: string) => wire,
  });

  expectTypeOf<ReturnType<typeof c.toWire>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.fromWire>>().toExtend<Promise<string>>();
});

test('factory accepts mixed async toWire + sync fromWire', () => {
  const c = defineTestCodec({
    typeId: 'demo/mixed-b@1',
    toWire: async (value: string) => value,
    fromWire: (wire: string) => wire,
  });

  expectTypeOf<ReturnType<typeof c.toWire>>().toExtend<Promise<string>>();
  expectTypeOf<ReturnType<typeof c.fromWire>>().toExtend<Promise<string>>();
});

test('factory rejects an omitted toWire — the property is required', () => {
  // @ts-expect-error toWire is required at the defineTestCodec() factory call site; the factory installs no identity fallback.
  defineTestCodec({
    typeId: 'demo/no-encode@1',
    fromWire: (wire: string) => wire,
  });
});

test('factory passes toDataTypeValue and fromDataTypeValue through as synchronous', () => {
  const c = defineTestCodec({
    typeId: 'demo/json@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => wire,
    toDataTypeValue: (value: string) => value,
    fromDataTypeValue: (value) => value.value as string,
  });

  expectTypeOf<ReturnType<typeof c.toDataTypeValue>>().not.toExtend<Promise<unknown>>();
  expectTypeOf<ReturnType<typeof c.fromDataTypeValue>>().not.toExtend<Promise<unknown>>();
});

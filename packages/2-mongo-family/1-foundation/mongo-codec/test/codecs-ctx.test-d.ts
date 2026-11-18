import {
  type CodecCallContext,
  type DataTypeValue,
  dataType,
  readJsonString,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import { mongoCodec } from '../src/codecs';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

test('Mongo uses the framework CodecCallContext directly (signal-only, no `column`)', () => {
  type Keys = keyof CodecCallContext;
  expectTypeOf<Keys>().toEqualTypeOf<'signal'>();
  expectTypeOf<Keys>().not.toExtend<'column'>();
});

test('mongoCodec() accepts a `(value, ctx)` toWire author', () => {
  const c = mongoCodec({
    typeId: 'demo/ctx-encode@1',
    toWire: (value: string, _ctx?: CodecCallContext) => value,
    fromWire: (wire: string) => wire,
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });
  expectTypeOf(c.toWire).toBeFunction();
  expectTypeOf<Parameters<typeof c.toWire>[1]>().toEqualTypeOf<CodecCallContext>();
});

test('mongoCodec() accepts a `(value, ctx)` fromWire author', () => {
  const c = mongoCodec({
    typeId: 'demo/ctx-decode@1',
    toWire: (value: string) => value,
    fromWire: (wire: string, _ctx?: CodecCallContext) => wire,
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });
  expectTypeOf<Parameters<typeof c.fromWire>[1]>().toEqualTypeOf<CodecCallContext>();
});

test('mongoCodec() accepts a single-arg `(value)` toWire author and exposes a Promise method', () => {
  const c = mongoCodec({
    typeId: 'demo/single-encode@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => wire,
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });
  expectTypeOf<ReturnType<typeof c.toWire>>().toExtend<Promise<string>>();
});

test('MongoCodec.toWire and MongoCodec.fromWire require a ctx argument', () => {
  const c = mongoCodec({
    typeId: 'demo/require-ctx@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => wire,
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });
  // @ts-expect-error — ctx is non-optional on the MongoCodec interface
  c.toWire('x');
  // @ts-expect-error — ctx is non-optional on the MongoCodec interface
  c.fromWire('x');
  // Legal: explicit ctx (signal is the only field today and is optional inside the ctx).
  void c.toWire('x', {});
  void c.fromWire('x', {});
});

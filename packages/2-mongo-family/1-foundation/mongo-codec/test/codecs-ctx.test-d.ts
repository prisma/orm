import { type CodecCallContext, decodeJsonString } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import { mongoCodec } from '../src/codecs';

test('Mongo uses the framework CodecCallContext directly (signal-only, no `column`)', () => {
  type Keys = keyof CodecCallContext;
  expectTypeOf<Keys>().toEqualTypeOf<'signal'>();
  expectTypeOf<Keys>().not.toExtend<'column'>();
});

test('mongoCodec() accepts a `(value, ctx)` encode author', () => {
  const c = mongoCodec({
    typeId: 'demo/ctx-encode@1',
    encode: (value: string, _ctx?: CodecCallContext) => value,
    decode: (wire: string) => wire,
    decodeJson: (json) => decodeJsonString('demo/ctx-encode@1', json),
  });
  expectTypeOf(c.encode).toBeFunction();
  expectTypeOf<Parameters<typeof c.encode>[1]>().toEqualTypeOf<CodecCallContext>();
});

test('mongoCodec() accepts a `(value, ctx)` decode author', () => {
  const c = mongoCodec({
    typeId: 'demo/ctx-decode@1',
    encode: (value: string) => value,
    decode: (wire: string, _ctx?: CodecCallContext) => wire,
    decodeJson: (json) => decodeJsonString('demo/ctx-decode@1', json),
  });
  expectTypeOf<Parameters<typeof c.decode>[1]>().toEqualTypeOf<CodecCallContext>();
});

test('mongoCodec() accepts a single-arg `(value)` encode author and exposes a Promise method', () => {
  const c = mongoCodec({
    typeId: 'demo/single-encode@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
    decodeJson: (json) => decodeJsonString('demo/single-encode@1', json),
  });
  expectTypeOf<ReturnType<typeof c.encode>>().toExtend<Promise<string>>();
});

test('MongoCodec.encode and MongoCodec.decode require a ctx argument', () => {
  const c = mongoCodec({
    typeId: 'demo/require-ctx@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
    decodeJson: (json) => decodeJsonString('demo/require-ctx@1', json),
  });
  // @ts-expect-error — ctx is non-optional on the MongoCodec interface
  c.encode('x');
  // @ts-expect-error — ctx is non-optional on the MongoCodec interface
  c.decode('x');
  // Legal: explicit ctx (signal is the only field today and is optional inside the ctx).
  void c.encode('x', {});
  void c.decode('x', {});
});

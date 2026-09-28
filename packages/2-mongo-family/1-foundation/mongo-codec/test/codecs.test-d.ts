import type { Codec as BaseCodec } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { MongoCodec, MongoCodecInput } from '../src/codecs';
import { mongoCodec } from '../src/codecs';

// MongoCodec takes BaseCodec's four generics in the same order, plus a fifth, `TOutput`, for what `decode` returns; it defaults to `TInput`, so a four-generic MongoCodec is a BaseCodec. Trait/targetType/renderOutputType metadata lives on the unified `CodecDescriptor` (TML-2357).
test('MongoCodec with four generics is assignable to BaseCodec', () => {
  expectTypeOf<MongoCodec<'id/x@1', readonly ['equality'], number, string>>().toExtend<
    BaseCodec<'id/x@1', readonly ['equality'], number, string>
  >();
});

// `MongoCodecInput<T>` surfaces the JS type a Mongo codec's `encode` takes; `decode` returns the same type unless the codec declares a separate `TOutput`.
test('MongoCodecInput extracts the JS application type a codec reads and writes', () => {
  const text = mongoCodec({
    typeId: 'demo/text@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf<MongoCodecInput<typeof text>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof text.encode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof text.decode>>().toEqualTypeOf<Promise<string>>();
});

test('the five-parameter mongoCodec decodes to its declared output type', () => {
  const literal = mongoCodec<'demo/literal@1', readonly [], string, string, 'on' | 'off'>({
    typeId: 'demo/literal@1',
    encode: (value: string) => value,
    decode: (wire: string) => (wire === 'on' ? 'on' : 'off'),
  });

  expectTypeOf<MongoCodecInput<typeof literal>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof literal.encode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof literal.decode>>().toEqualTypeOf<Promise<'on' | 'off'>>();
  expectTypeOf(literal).toExtend<MongoCodec<string>>();
});

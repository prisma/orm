import type { Codec as BaseCodec } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { MongoCodec, MongoCodecInput } from '../src/codecs';
import { mongoCodec } from '../src/codecs';

// MongoCodec extends `BaseCodec` and carries the same four generics in the same order. Trait/targetType/renderOutputType metadata moved to the unified `CodecDescriptor` (TML-2357); the codec instance is now a pure conversion record.
test('MongoCodec is assignable to BaseCodec (4 generics, same order)', () => {
  expectTypeOf<MongoCodec<'id/x@1', readonly ['equality'], number, string>>().toExtend<
    BaseCodec<'id/x@1', readonly ['equality'], number, string>
  >();
});

// `MongoCodecInput<T>` surfaces the JS application type of a Mongo codec — used both as `encode`'s input and as `decode`'s output, since the codec translates one JS application type to/from one wire format.
test('MongoCodecInput extracts the JS application type used for both write input and read output', () => {
  const text = mongoCodec({
    typeId: 'demo/text@1',
    encode: (value: string) => value,
    decode: (wire: string) => wire,
  });

  expectTypeOf<MongoCodecInput<typeof text>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof text.encode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof text.decode>>().toEqualTypeOf<string>();
});

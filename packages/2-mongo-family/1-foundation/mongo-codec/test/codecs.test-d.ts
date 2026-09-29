import type { JsonValue } from '@internal/contract/types';
import { type Codec as BaseCodec, decodeJsonString } from '@internal/framework-components/codec';
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
    decodeJson: (json) => decodeJsonString('demo/text@1', json),
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
    decodeJson: (json) => decodeJsonString('demo/literal@1', json),
  });

  expectTypeOf<MongoCodecInput<typeof literal>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof literal.encode>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof literal.decode>>().toEqualTypeOf<Promise<'on' | 'off'>>();
  expectTypeOf(literal).toExtend<MongoCodec<string>>();
});

const narrowerThanJson = {
  typeId: 'demo/narrow@1',
  encode: (value: string) => value,
  decode: (wire: string) => wire,
};

test('a codec whose application type is narrower than JsonValue does not compile without decodeJson', () => {
  // @ts-expect-error — an identity decodeJson would return any JSON value as a string
  mongoCodec(narrowerThanJson);

  const checked = mongoCodec({
    ...narrowerThanJson,
    decodeJson: (json) => decodeJsonString('demo/narrow@1', json),
  });
  expectTypeOf(checked.decodeJson).returns.toEqualTypeOf<string>();
  expectTypeOf(checked.encodeJson).returns.toEqualTypeOf<JsonValue>();
});

test('each narrower JSON application type requires decodeJson', () => {
  const numberCodec = {
    typeId: 'demo/number@1',
    encode: (value: number) => value,
    decode: (wire: number) => wire,
  };
  const booleanCodec = {
    typeId: 'demo/boolean@1',
    encode: (value: boolean) => value,
    decode: (wire: boolean) => wire,
  };
  const vectorCodec = {
    typeId: 'demo/vector@1',
    encode: (value: readonly number[]) => value,
    decode: (wire: readonly number[]) => wire,
  };
  // @ts-expect-error — number is narrower than JsonValue
  mongoCodec(numberCodec);
  // @ts-expect-error — boolean is narrower than JsonValue
  mongoCodec(booleanCodec);
  // @ts-expect-error — readonly number[] is narrower than JsonValue
  mongoCodec(vectorCodec);
});

test('a codec whose application type is exactly JsonValue may omit both JSON methods', () => {
  const json = mongoCodec({
    typeId: 'demo/json@1',
    encode: (value: JsonValue) => value,
    decode: (wire: JsonValue) => wire,
  });
  expectTypeOf(json.decodeJson).returns.toEqualTypeOf<JsonValue>();
});

test('a codec whose application type is not JSON needs both JSON methods', () => {
  const dateCodec = {
    typeId: 'demo/date@1',
    encode: (value: Date) => value,
    decode: (wire: Date) => wire,
    decodeJson: (json: JsonValue) => new Date(String(json)),
  };
  // @ts-expect-error — a Date has no identity JSON form
  mongoCodec(dateCodec);
});

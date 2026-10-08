import type { JsonValue } from '@internal/contract/types';
import {
  type Codec as BaseCodec,
  type DataTypeValue,
  dataType,
  readJsonString,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { MongoCodec, MongoCodecInput } from '../src/codecs';
import { mongoCodec } from '../src/codecs';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });
const jsonType = dataType('test/json', { read: (json) => json });

// MongoCodec takes BaseCodec's four generics in the same order, plus a fifth, `TOutput`, for what `fromWire` returns; it defaults to `TInput`, so a four-generic MongoCodec is a BaseCodec. Trait/targetType/renderOutputType metadata lives on the unified `CodecDescriptor` (TML-2357).
test('MongoCodec with four generics is assignable to BaseCodec', () => {
  expectTypeOf<MongoCodec<'id/x@1', readonly ['equality'], number, string>>().toExtend<
    BaseCodec<'id/x@1', readonly ['equality'], number, string>
  >();
});

// `MongoCodecInput<T>` surfaces the JS type a Mongo codec's `toWire` takes; `fromWire` returns the same type unless the codec declares a separate `TOutput`.
test('MongoCodecInput extracts the JS application type a codec reads and writes', () => {
  const text = mongoCodec({
    typeId: 'demo/text@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => wire,
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });

  expectTypeOf<MongoCodecInput<typeof text>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof text.toWire>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof text.fromWire>>().toEqualTypeOf<Promise<string>>();
});

test('the five-parameter mongoCodec reads wire values as its declared output type', () => {
  const literal = mongoCodec<'demo/literal@1', readonly [], string, string, 'on' | 'off'>({
    typeId: 'demo/literal@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => (wire === 'on' ? 'on' : 'off'),
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });

  expectTypeOf<MongoCodecInput<typeof literal>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<typeof literal.toWire>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<typeof literal.fromWire>>().toEqualTypeOf<Promise<'on' | 'off'>>();
  expectTypeOf(literal).toExtend<MongoCodec<string>>();
});

const narrowerThanJson = {
  typeId: 'demo/narrow@1',
  dataType: textType,
  toWire: (value: string) => value,
  fromWire: (wire: string) => wire,
};

test('a codec whose application type is narrower than JsonValue does not compile without fromDataTypeValue', () => {
  // @ts-expect-error — an identity fromDataTypeValue would return any JSON value as a string
  mongoCodec(narrowerThanJson);

  const checked = mongoCodec({
    ...narrowerThanJson,
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });
  expectTypeOf(checked.fromDataTypeValue).returns.toEqualTypeOf<string>();
  expectTypeOf(checked.toDataTypeValue).returns.toEqualTypeOf<DataTypeValue>();
});

test('each narrower JSON application type requires fromDataTypeValue', () => {
  const numberCodec = {
    typeId: 'demo/number@1',
    dataType: jsonType,
    toWire: (value: number) => value,
    fromWire: (wire: number) => wire,
  };
  const booleanCodec = {
    typeId: 'demo/boolean@1',
    dataType: jsonType,
    toWire: (value: boolean) => value,
    fromWire: (wire: boolean) => wire,
  };
  const vectorCodec = {
    typeId: 'demo/vector@1',
    dataType: jsonType,
    toWire: (value: readonly number[]) => value,
    fromWire: (wire: readonly number[]) => wire,
  };
  // @ts-expect-error — number is narrower than JsonValue
  mongoCodec(numberCodec);
  // @ts-expect-error — boolean is narrower than JsonValue
  mongoCodec(booleanCodec);
  // @ts-expect-error — readonly number[] is narrower than JsonValue
  mongoCodec(vectorCodec);
});

test('a codec whose application type is exactly JsonValue may omit both value methods', () => {
  const json = mongoCodec({
    typeId: 'demo/json@1',
    dataType: jsonType,
    toWire: (value: JsonValue) => value,
    fromWire: (wire: JsonValue) => wire,
  });
  expectTypeOf(json.fromDataTypeValue).returns.toEqualTypeOf<JsonValue>();
});

test('a codec whose application type is not JSON needs both value methods', () => {
  const dateCodec = {
    typeId: 'demo/date@1',
    dataType: textType,
    toWire: (value: Date) => value,
    fromWire: (wire: Date) => wire,
    fromDataTypeValue: (value: DataTypeValue) => new Date(String(value.value)),
  };
  // @ts-expect-error — a Date has no identity JSON form
  mongoCodec(dateCodec);
});

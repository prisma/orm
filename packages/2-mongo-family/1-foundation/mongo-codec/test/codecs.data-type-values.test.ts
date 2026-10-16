import type { JsonValue } from '@internal/contract/types';
import { type DataTypeValue, dataType } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoCodec } from '../src/codecs';

const text = dataType('test/text', { read: (json) => json });
const other = dataType('test/other', { read: (json) => json });

const codec = mongoCodec({
  typeId: 'test/text@1',
  dataType: text,
  toWire: (value: string) => value,
  fromWire: (wire: string) => wire,
  toDataTypeValue: (value: string) => text.valueFrom(value.toUpperCase(), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

describe('a Mongo codec hands over the value its toDataTypeValue builds', () => {
  it('returns the value of its data type the author built', () => {
    expect(codec.toDataTypeValue('a')).toEqual(text.fromContract('A', {}));
  });

  it('builds the value through the data type when the author writes no toDataTypeValue', () => {
    const json = dataType('test/json', { read: (value) => value });
    const passThrough = mongoCodec({
      typeId: 'test/json@1',
      dataType: json,
      params: {},
      toWire: (value: JsonValue) => value,
      fromWire: (wire: JsonValue) => wire,
    });
    expect(passThrough.toDataTypeValue({ a: 1 })).toEqual(json.fromContract({ a: 1 }, {}));
  });
});

describe('a Mongo codec converts only values of its own data type', () => {
  it('converts a value of its data type', () => {
    expect(codec.fromDataTypeValue(text.fromContract('a', {}))).toBe('a');
  });

  it('refuses a value of another data type', () => {
    expect(() => codec.fromDataTypeValue(other.fromContract('a', {}))).toThrow(
      'Codec test/text@1 takes only values of test/text, and was handed a value of test/other.',
    );
  });

  it('refuses an object no data type constructed', () => {
    const forged = { type: text.id, params: {}, value: 'a' } as unknown as DataTypeValue;
    expect(() => codec.fromDataTypeValue(forged)).toThrow(
      'Codec test/text@1 takes only values of test/text, and was handed an object no data type constructed.',
    );
  });
});

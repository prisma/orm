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
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

describe('a Mongo codec converts only values of its own data type', () => {
  it('converts a value of its data type', () => {
    expect(codec.fromDataTypeValue(text.fromContract('a', {}))).toBe('a');
  });

  it('refuses a value of another data type', () => {
    expect(() => codec.fromDataTypeValue(other.fromContract('a', {}))).toThrow(
      'Codec test/text@1 converts values of test/text, and was handed a value of test/other.',
    );
  });
});

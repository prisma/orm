import { describe, expect, it } from 'vitest';
import { type Codec, CodecImpl } from '../src/shared/codec';
import { CodecDescriptorImpl } from '../src/shared/codec-descriptor';
import type { CodecInstanceContext } from '../src/shared/codec-types';
import { type DataTypeValue, dataType } from '../src/shared/data-type';

const int4 = dataType('demo/int4', { read: (json) => json });
const int8 = dataType('demo/int8', { read: (json) => json });

class Int8Codec extends CodecImpl<'demo/int8@1', readonly [], string, bigint> {
  fromDataTypeValue(value: DataTypeValue<string>): bigint {
    return BigInt(value.value);
  }
  toDataTypeValue(input: bigint): DataTypeValue {
    return this.dataTypeValueOf(input.toString());
  }
  async fromWire(wire: string): Promise<bigint> {
    return BigInt(wire);
  }
  async toWire(input: bigint): Promise<string> {
    return input.toString();
  }
}

class Int8Descriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = int8.id;
  override readonly codecId = 'demo/int8@1';
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => Int8Codec {
    return () => new Int8Codec(this, int8);
  }
}

const codec: Codec = new Int8Descriptor().factory()({ name: 'demo' });

describe('a codec converts only values of its own data type', () => {
  it('converts a value of its data type', () => {
    expect(codec.fromDataTypeValue(int8.fromContract('42', {}))).toBe(42n);
  });

  it('refuses a value of another data type', () => {
    expect(() => codec.fromDataTypeValue(int4.fromContract('42', {}))).toThrow(
      'Codec demo/int8@1 converts values of demo/int8, and was handed a value of demo/int4.',
    );
  });
});

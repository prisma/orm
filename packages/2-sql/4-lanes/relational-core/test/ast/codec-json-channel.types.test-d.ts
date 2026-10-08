import type { JsonValue } from '@internal/contract/types';
import {
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
  dataType,
} from '@internal/framework-components/codec';
import { describe, expectTypeOf, it } from 'vitest';
import type { ExtractCodecTypes } from '../../src/ast/codec-types';

const int8 = dataType('test/int8', { read: (json) => json });

class DigitsCodec extends CodecImpl<'test/digits@1', readonly [], string, bigint> {
  fromDataTypeValue(value: DataTypeValue<string>): bigint {
    return BigInt(value.value);
  }
  toDataTypeValue(input: bigint): DataTypeValue<string> {
    return this.dataTypeValueOf(input.toString());
  }
  async fromWire(wire: string): Promise<bigint> {
    return BigInt(wire);
  }
  async toWire(input: bigint): Promise<string> {
    return input.toString();
  }
}

class AnyJsonCodec extends CodecImpl<'test/any@1', readonly [], string, bigint> {
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

class DigitsDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = int8.id;
  override readonly codecId = 'test/digits@1' as const;
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => DigitsCodec {
    return () => new DigitsCodec(this, int8);
  }
}

class AnyJsonDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = int8.id;
  override readonly codecId = 'test/any@1' as const;
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => AnyJsonCodec {
    return () => new AnyJsonCodec(this, int8);
  }
}

type Types = ExtractCodecTypes<{ digits: DigitsDescriptor; any: AnyJsonDescriptor }>;

describe("a codec type's json member follows toDataTypeValue", () => {
  it('is the JSON type of the value a codec that narrows its return hands over', () => {
    expectTypeOf<Types['test/digits@1']['json']>().not.toBeNever();
    expectTypeOf<Types['test/digits@1']['json']>().toEqualTypeOf<string>();
  });

  it('is JsonValue for a codec that does not narrow its return', () => {
    expectTypeOf<Types['test/any@1']['json']>().not.toBeNever();
    expectTypeOf<Types['test/any@1']['json']>().toEqualTypeOf<JsonValue>();
  });
});

/**
 * Every codec descriptor names the data type it represents; a template, which a target adapts,
 * names it at adaptation instead. ADR 254, spec B1.
 */

import type { JsonValue } from '@internal/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expectTypeOf, test } from 'vitest';
import {
  type Codec,
  type CodecCallContext,
  type CodecDescriptor,
  CodecDescriptorImpl,
  type CodecDescriptorTemplate,
  CodecDescriptorTemplateImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecTrait,
  type DataTypeId,
  dataTypeId,
  voidParamsSchema,
} from '../src/exports/codec';

const demoInt = dataTypeId('demo/int');

class DemoCodec extends CodecImpl<'demo/int@1', readonly ['equality'], number, number> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return Number(json);
  }
}

abstract class DemoDescriptorBody<P> extends CodecDescriptorTemplateImpl<P> {
  override readonly codecId = 'demo/int@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly targetTypes: readonly string[] = ['int'];
  override readonly paramsSchema: StandardSchemaV1<P> =
    voidParamsSchema as unknown as StandardSchemaV1<P>;
  override factory(): (ctx: CodecInstanceContext) => Codec {
    return () => new DemoCodec(this);
  }
}

class DemoDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = demoInt;
  override readonly codecId = 'demo/int@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly targetTypes: readonly string[] = ['int'];
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
  override factory(): (ctx: CodecInstanceContext) => Codec {
    return () => new DemoCodec(this);
  }
}

class DemoTemplate extends DemoDescriptorBody<void> {}

test('a descriptor names one data type', () => {
  expectTypeOf(new DemoDescriptor().dataType).toEqualTypeOf<DataTypeId>();
  expectTypeOf<CodecDescriptor<void>['dataType']>().toEqualTypeOf<DataTypeId>();
});

test('a template names none, and is not a descriptor', () => {
  expectTypeOf<CodecDescriptorTemplate<void>>().not.toHaveProperty('dataType');
  expectTypeOf(new DemoTemplate()).not.toMatchTypeOf<CodecDescriptor<void>>();
});

test('a descriptor without a data type does not type-check', () => {
  const missing = {
    codecId: 'demo/int@1',
    traits: ['equality'] as readonly CodecTrait[],
    targetTypes: ['int'] as readonly string[],
    paramsSchema: voidParamsSchema,
    isParameterized: false,
    factory: () => () => new DemoCodec(new DemoDescriptor()),
  };
  // @ts-expect-error a codec descriptor names the data type it represents
  const descriptor: CodecDescriptor<void> = missing;
  expectTypeOf(descriptor).toMatchTypeOf<CodecDescriptor<void>>();
});

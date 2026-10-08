import { expectTypeOf, test } from 'vitest';
import type { Codec } from '../src/shared/codec';
import type { CodecTrait } from '../src/shared/codec-types';
import type { DataTypeValue } from '../src/shared/data-type';

test('toWire is required and Promise-returning', () => {
  expectTypeOf<Codec>().toHaveProperty('toWire');
  expectTypeOf<Codec['toWire']>().toBeFunction();
  type ToWireReturn = ReturnType<Codec['toWire']>;
  expectTypeOf<ToWireReturn>().toExtend<Promise<unknown>>();
});

test('fromWire is required and Promise-returning', () => {
  expectTypeOf<Codec>().toHaveProperty('fromWire');
  expectTypeOf<Codec['fromWire']>().toBeFunction();
  type FromWireReturn = ReturnType<Codec['fromWire']>;
  expectTypeOf<FromWireReturn>().toExtend<Promise<unknown>>();
});

test('toDataTypeValue is required, synchronous and returns a data type value', () => {
  expectTypeOf<Codec>().toHaveProperty('toDataTypeValue');
  expectTypeOf<Codec['toDataTypeValue']>().toBeFunction();
  type ToDataTypeValueReturn = ReturnType<Codec['toDataTypeValue']>;
  expectTypeOf<ToDataTypeValueReturn>().toEqualTypeOf<DataTypeValue>();
});

test('fromDataTypeValue is required, synchronous and takes a data type value', () => {
  expectTypeOf<Codec>().toHaveProperty('fromDataTypeValue');
  expectTypeOf<Codec['fromDataTypeValue']>().toBeFunction();
  expectTypeOf<Parameters<Codec['fromDataTypeValue']>[0]>().toEqualTypeOf<DataTypeValue>();
  type FromDataTypeValueReturn = ReturnType<Codec['fromDataTypeValue']>;
  expectTypeOf<FromDataTypeValueReturn>().not.toExtend<Promise<unknown>>();
});

test('Codec instance carries only id, its data type and the four conversion methods (plus phantom)', () => {
  // The runtime instance is narrowed to id + behavior (TML-2357); codec-id-keyed static metadata (`traits`, `renderOutputType`) lives on `CodecDescriptor` keyed by codecId. The `__codecTraits` slot is a type-only phantom carrier (always `undefined` at runtime) and double-underscored to signal that it is not part of the consumer-facing API surface.
  type CodecStringKeys = Extract<keyof Codec, string>;
  const expectedKeys = [
    'id',
    'dataType',
    'toWire',
    'fromWire',
    'toDataTypeValue',
    'fromDataTypeValue',
    '__codecTraits',
  ] as const;
  type ExpectedKeys = (typeof expectedKeys)[number];
  expectTypeOf<CodecStringKeys>().toEqualTypeOf<ExpectedKeys>();
});

test('Codec instance does not carry traits / meta / renderOutputType', () => {
  type C = Codec;
  expectTypeOf<C>().not.toHaveProperty('traits');
  expectTypeOf<C>().not.toHaveProperty('meta');
  expectTypeOf<C>().not.toHaveProperty('renderOutputType');
});

test('Codec carries four generics: toWire TInput → TWire, fromWire TWire → TInput', () => {
  type StringTextCodec = Codec<'demo/text@1', readonly CodecTrait[], string, string>;
  expectTypeOf<Parameters<StringTextCodec['toWire']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<StringTextCodec['toWire']>>().toExtend<Promise<string>>();
  expectTypeOf<Parameters<StringTextCodec['fromWire']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<StringTextCodec['fromWire']>>().toExtend<Promise<string>>();
  expectTypeOf<Parameters<StringTextCodec['toDataTypeValue']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<StringTextCodec['fromDataTypeValue']>>().toEqualTypeOf<string>();
});

test('TInput drives both write input and read output (no asymmetric output)', () => {
  type WireSeparateFromInput = Codec<'demo/distinct-wire@1', readonly CodecTrait[], number, string>;
  expectTypeOf<Parameters<WireSeparateFromInput['toWire']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<WireSeparateFromInput['toWire']>>().toExtend<Promise<number>>();
  expectTypeOf<Parameters<WireSeparateFromInput['fromWire']>[0]>().toEqualTypeOf<number>();
  expectTypeOf<ReturnType<WireSeparateFromInput['fromWire']>>().toExtend<Promise<string>>();
});

import type { JsonValue } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Codec } from '../src/shared/codec';
import type { CodecTrait } from '../src/shared/codec-types';

test('encode is required and Promise-returning', () => {
  expectTypeOf<Codec>().toHaveProperty('encode');
  expectTypeOf<Codec['encode']>().toBeFunction();
  type EncodeReturn = ReturnType<NonNullable<Codec['encode']>>;
  expectTypeOf<EncodeReturn>().toExtend<Promise<unknown>>();
});

test('decode is required and synchronous', () => {
  expectTypeOf<Codec>().toHaveProperty('decode');
  expectTypeOf<Codec['decode']>().toBeFunction();
  type DecodeReturn = ReturnType<Codec['decode']>;
  expectTypeOf<DecodeReturn>().toEqualTypeOf<unknown>();
});

test('encodeJson is required and synchronous', () => {
  expectTypeOf<Codec>().toHaveProperty('encodeJson');
  expectTypeOf<Codec['encodeJson']>().toBeFunction();
  type EncodeJsonReturn = ReturnType<Codec['encodeJson']>;
  expectTypeOf<EncodeJsonReturn>().toEqualTypeOf<JsonValue>();
});

test('decodeJson is required and synchronous', () => {
  expectTypeOf<Codec>().toHaveProperty('decodeJson');
  expectTypeOf<Codec['decodeJson']>().toBeFunction();
  type DecodeJsonReturn = ReturnType<Codec['decodeJson']>;
  // synchronous: not a Promise
  expectTypeOf<DecodeJsonReturn>().not.toExtend<Promise<unknown>>();
});

test('Codec instance carries only id + the four conversion methods (plus phantom)', () => {
  // The runtime instance is narrowed to id + behavior (TML-2357); codec-id-keyed static metadata (`traits`, `targetTypes`, `renderOutputType`) lives on `CodecDescriptor` keyed by codecId. The `__codecTraits` slot is a type-only phantom carrier (always `undefined` at runtime) and double-underscored to signal that it is not part of the consumer-facing API surface.
  type CodecStringKeys = Extract<keyof Codec, string>;
  const expectedKeys = [
    'id',
    'encode',
    'decode',
    'encodeJson',
    'decodeJson',
    '__codecTraits',
  ] as const;
  type ExpectedKeys = (typeof expectedKeys)[number];
  expectTypeOf<CodecStringKeys>().toEqualTypeOf<ExpectedKeys>();
});

test('Codec instance does not carry traits / targetTypes / meta / renderOutputType', () => {
  type C = Codec;
  expectTypeOf<C>().not.toHaveProperty('traits');
  expectTypeOf<C>().not.toHaveProperty('targetTypes');
  expectTypeOf<C>().not.toHaveProperty('meta');
  expectTypeOf<C>().not.toHaveProperty('renderOutputType');
});

test('Codec carries four generics: encode TInput → TWire, decode TWire → TInput', () => {
  type StringTextCodec = Codec<'demo/text@1', readonly CodecTrait[], string, string>;
  expectTypeOf<Parameters<StringTextCodec['encode']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<StringTextCodec['encode']>>().toExtend<Promise<string>>();
  expectTypeOf<Parameters<StringTextCodec['decode']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<StringTextCodec['decode']>>().toEqualTypeOf<string>();
  expectTypeOf<Parameters<StringTextCodec['encodeJson']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<StringTextCodec['decodeJson']>>().toEqualTypeOf<string>();
});

test('TInput drives both write input and read output (no asymmetric output)', () => {
  type WireSeparateFromInput = Codec<'demo/distinct-wire@1', readonly CodecTrait[], number, string>;
  expectTypeOf<Parameters<WireSeparateFromInput['encode']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<WireSeparateFromInput['encode']>>().toExtend<Promise<number>>();
  expectTypeOf<Parameters<WireSeparateFromInput['decode']>[0]>().toEqualTypeOf<number>();
  expectTypeOf<ReturnType<WireSeparateFromInput['decode']>>().toEqualTypeOf<string>();
});

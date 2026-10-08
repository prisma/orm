import { expectTypeOf, test } from 'vitest';
import type { Codec } from '../src/shared/codec';
import type { CodecCallContext } from '../src/shared/codec-types';

test('CodecCallContext is signal-only at the framework level', () => {
  type Signal = NonNullable<CodecCallContext['signal']>;
  expectTypeOf<Signal>().toEqualTypeOf<AbortSignal>();
});

test('CodecCallContext has exactly one optional field (signal)', () => {
  type Keys = keyof CodecCallContext;
  expectTypeOf<Keys>().toEqualTypeOf<'signal'>();
  type SignalIsOptional = undefined extends CodecCallContext['signal'] ? true : false;
  expectTypeOf<SignalIsOptional>().toEqualTypeOf<true>();
});

test('CodecCallContext does not declare a `column` field (SQL-family concept)', () => {
  type Keys = keyof CodecCallContext;
  expectTypeOf<Keys>().not.toExtend<'column'>();
});

test('Codec.encode requires a CodecCallContext as a second argument', () => {
  type EncodeParams = Parameters<Codec<'demo/x@1', readonly [], string, string>['toWire']>;
  expectTypeOf<EncodeParams[0]>().toEqualTypeOf<string>();
  expectTypeOf<EncodeParams[1]>().toEqualTypeOf<CodecCallContext>();
});

test('Codec.decode requires a CodecCallContext as a second argument', () => {
  type DecodeParams = Parameters<Codec<'demo/x@1', readonly [], string, string>['fromWire']>;
  expectTypeOf<DecodeParams[0]>().toEqualTypeOf<string>();
  expectTypeOf<DecodeParams[1]>().toEqualTypeOf<CodecCallContext>();
});

test('encode/decode call sites accept an explicit ctx (signal optional inside the ctx)', () => {
  type StringCodec = Codec<'demo/text@1', readonly [], string, string>;
  const encodeWithCtx = (c: StringCodec, v: string, ctx: CodecCallContext): Promise<string> =>
    c.toWire(v, ctx);
  const decodeWithCtx = (c: StringCodec, w: string, ctx: CodecCallContext): Promise<string> =>
    c.fromWire(w, ctx);
  // An empty ctx is legal — `signal` is the only field today and is optional inside the context shape.
  const encodeWithEmptyCtx = (c: StringCodec, v: string): Promise<string> => c.toWire(v, {});
  const decodeWithEmptyCtx = (c: StringCodec, w: string): Promise<string> => c.fromWire(w, {});
  void encodeWithCtx;
  void decodeWithCtx;
  void encodeWithEmptyCtx;
  void decodeWithEmptyCtx;
});

// ADR 204 walk-back constraints — captured here so future refactors cannot reintroduce a `TRuntime` generic, a discriminator field, conditional return types, or other shape complications on the public Codec.

test('Codec carries no `runtime` or `kind` discriminator field', () => {
  type CodecKeys = keyof Codec;
  expectTypeOf<CodecKeys>().not.toExtend<'runtime'>();
  expectTypeOf<CodecKeys>().not.toExtend<'kind'>();
});

test('Codec has exactly four type parameters (Id, TTraits, TWire, TInput) — no TRuntime', () => {
  // If a fifth `TRuntime` generic were added before TWire/TInput, this call shape would either fail or produce an unrelated codec type.
  type FourGenericCodec = Codec<'demo/four@1', readonly [], number, string>;
  expectTypeOf<Parameters<FourGenericCodec['toWire']>[0]>().toEqualTypeOf<string>();
  expectTypeOf<ReturnType<FourGenericCodec['toWire']>>().toExtend<Promise<number>>();
});

test('encode return type is unconditionally Promise<TWire> (no conditional types)', () => {
  type CodecA = Codec<'demo/a@1', readonly [], string, string>;
  type CodecB = Codec<'demo/b@1', readonly [], number, number>;
  expectTypeOf<ReturnType<CodecA['toWire']>>().toEqualTypeOf<Promise<string>>();
  expectTypeOf<ReturnType<CodecB['toWire']>>().toEqualTypeOf<Promise<number>>();
});

test('decode return type is unconditionally Promise<TInput> (no conditional types)', () => {
  type CodecA = Codec<'demo/a@1', readonly [], string, string>;
  type CodecB = Codec<'demo/b@1', readonly [], number, number>;
  expectTypeOf<ReturnType<CodecA['fromWire']>>().toEqualTypeOf<Promise<string>>();
  expectTypeOf<ReturnType<CodecB['fromWire']>>().toEqualTypeOf<Promise<number>>();
});

import type { CodecCallContext } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { Codec, SqlCodecCallContext, SqlColumnRef } from '../../src/ast/codec-types';
import { defineTestCodec } from './test-codec';

test('SqlCodecCallContext extends framework CodecCallContext (signal) and adds column', () => {
  type Signal = NonNullable<SqlCodecCallContext['signal']>;
  expectTypeOf<Signal>().toEqualTypeOf<AbortSignal>();
  type Column = NonNullable<SqlCodecCallContext['column']>;
  expectTypeOf<Column>().toEqualTypeOf<SqlColumnRef>();
  // SqlCodecCallContext is assignable to CodecCallContext (extension).
  const sql: SqlCodecCallContext = { signal: new AbortController().signal };
  const fw: CodecCallContext = sql;
  void fw;
});

test('SQL Codec.toWire/fromWire narrow ctx to SqlCodecCallContext (non-optional at the interface)', () => {
  type SqlCodec = Codec<'demo/x@1', readonly [], string, string>;
  type EncodeParams = Parameters<SqlCodec['toWire']>;
  type DecodeParams = Parameters<SqlCodec['fromWire']>;
  expectTypeOf<EncodeParams[1]>().toEqualTypeOf<SqlCodecCallContext>();
  expectTypeOf<DecodeParams[1]>().toEqualTypeOf<SqlCodecCallContext>();
});

test('Codec.toWire and Codec.fromWire require a ctx argument', () => {
  const c = defineTestCodec({
    typeId: 'demo/require-ctx@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => wire,
  });
  // @ts-expect-error — ctx is non-optional on the Codec interface
  c.toWire('x');
  // @ts-expect-error — ctx is non-optional on the Codec interface
  c.fromWire('x');
  // Legal: explicit ctx (signal is the only field today and is optional inside the ctx).
  void c.toWire('x', {});
  void c.fromWire('x', {});
});

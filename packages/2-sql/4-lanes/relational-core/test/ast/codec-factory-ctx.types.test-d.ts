import type { CodecCallContext } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { Codec, SqlCodecCallContext, SqlColumnRef } from '../../src/ast/codec-types';
import { defineTestCodec } from './test-codec';

test('SqlColumnRef shape is `{ table, name }`', () => {
  expectTypeOf<SqlColumnRef>().toEqualTypeOf<{
    readonly table: string;
    readonly name: string;
  }>();
});

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

test('factory accepts a `(value, ctx: SqlCodecCallContext)` toWire author', () => {
  const c = defineTestCodec({
    typeId: 'demo/ctx-encode@1',
    toWire: (value: string, _ctx?: SqlCodecCallContext) => value,
    fromWire: (wire: string) => wire,
  });
  expectTypeOf(c.toWire).toBeFunction();
  expectTypeOf<Parameters<typeof c.toWire>[1]>().toEqualTypeOf<SqlCodecCallContext>();
});

test('factory accepts a `(value, ctx: SqlCodecCallContext)` fromWire author', () => {
  const c = defineTestCodec({
    typeId: 'demo/ctx-decode@1',
    toWire: (value: string) => value,
    fromWire: (wire: string, _ctx?: SqlCodecCallContext) => wire,
  });
  expectTypeOf(c.fromWire).toBeFunction();
  expectTypeOf<Parameters<typeof c.fromWire>[1]>().toEqualTypeOf<SqlCodecCallContext>();
});

test('factory accepts a single-arg `(value)` toWire author and exposes a Promise method', () => {
  const c = defineTestCodec({
    typeId: 'demo/single-encode@1',
    toWire: (value: string) => value,
    fromWire: (wire: string) => wire,
  });
  expectTypeOf<ReturnType<typeof c.toWire>>().toExtend<Promise<string>>();
});

test('factory lifts an async ctx-bearing toWire into a Promise method', () => {
  const c = defineTestCodec({
    typeId: 'demo/async-ctx-encode@1',
    toWire: async (value: string, _ctx?: SqlCodecCallContext) => value,
    fromWire: (wire: string) => wire,
  });
  expectTypeOf<ReturnType<typeof c.toWire>>().toExtend<Promise<string>>();
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

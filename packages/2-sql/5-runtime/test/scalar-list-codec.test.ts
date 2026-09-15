/**
 * Unit tests for element-wise encode/decode of many (scalar-list) CodecRef nodes.
 *
 * Covers:
 *   - Encode: maps element codec over a JS array; NULL elements pass through.
 *   - Decode: maps element codec over a driver-parsed JS array; NULL elements pass through.
 *   - RUNTIME.DECODE_FAILED: element-level decode failure surfaces through the existing envelope.
 *   - RUNTIME.ENCODE_FAILED: element-level encode failure surfaces through the existing envelope.
 */

import {
  ColumnRef,
  type ContractCodecRegistry,
  ParamRef,
  ProjectionItem,
  SelectAst,
  type SqlCodecCallContext,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { buildDecodeContext, decodeRow, sqlNativeArrayListDecoder } from '../src/codecs/decoding';
import { encodeParam } from '../src/codecs/encoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

const CTX: SqlCodecCallContext = {};

function makeRegistry(
  codecId: string,
  encode: (v: unknown) => unknown,
  decode: (w: unknown) => unknown,
): ContractCodecRegistry {
  const identity = (v: unknown) => v as never;
  const codec = defineTestCodec({
    typeId: codecId,
    encode: (v: unknown) => encode(v),
    decode: (w: unknown) => decode(w),
    encodeJson: identity,
    decodeJson: identity,
  });
  return buildTestContractCodecs([codec]);
}

// ---------------------------------------------------------------------------
// Encode — many-aware element loop
// ---------------------------------------------------------------------------

describe('encodeParam — many CodecRef', () => {
  it('maps the element codec over each element of the JS array', async () => {
    const calls: unknown[] = [];
    const registry = makeRegistry(
      'test/upper@1',
      (v) => {
        calls.push(v);
        return `ENC:${v}`;
      },
      (w) => w,
    );

    const result = await encodeParam(
      ['a', 'b', 'c'],
      { codec: { codecId: 'test/upper@1', many: true }, name: 'tags' },
      0,
      CTX,
      registry,
    );

    expect(result).toEqual(['ENC:a', 'ENC:b', 'ENC:c']);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('passes null elements through without invoking the element codec', async () => {
    const calls: unknown[] = [];
    const registry = makeRegistry(
      'test/upper@1',
      (v) => {
        calls.push(v);
        return `ENC:${v}`;
      },
      (w) => w,
    );

    const result = await encodeParam(
      ['a', null, 'c'],
      { codec: { codecId: 'test/upper@1', many: true }, name: 'tags' },
      0,
      CTX,
      registry,
    );

    expect(result).toEqual(['ENC:a', null, 'ENC:c']);
    expect(calls).toEqual(['a', 'c']);
  });

  it('wraps an element-level encode failure in RUNTIME.ENCODE_FAILED', async () => {
    const registry = makeRegistry(
      'test/throw@1',
      (_v) => {
        throw new Error('element encode error');
      },
      (w) => w,
    );

    await expect(
      encodeParam(
        ['ok', 'bad'],
        { codec: { codecId: 'test/throw@1', many: true }, name: 'col' },
        0,
        CTX,
        registry,
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
    });
  });

  it('returns null without calling the codec when the whole array value is null', async () => {
    let called = false;
    const registry = makeRegistry(
      'test/upper@1',
      (v) => {
        called = true;
        return v;
      },
      (w) => w,
    );

    const result = await encodeParam(
      null,
      { codec: { codecId: 'test/upper@1', many: true }, name: 'tags' },
      0,
      CTX,
      registry,
    );

    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it('scalar path (no many flag) is unchanged: applies codec to the whole value', async () => {
    const calls: unknown[] = [];
    const registry = makeRegistry(
      'test/upper@1',
      (v) => {
        calls.push(v);
        return `ENC:${v}`;
      },
      (w) => w,
    );

    const result = await encodeParam(
      'hello',
      { codec: { codecId: 'test/upper@1' }, name: 'name' },
      0,
      CTX,
      registry,
    );

    expect(result).toBe('ENC:hello');
    expect(calls).toEqual(['hello']);
  });
});

// ---------------------------------------------------------------------------
// Decode — many-aware element loop
// ---------------------------------------------------------------------------

describe('decodeRow — many CodecRef via ProjectionItem', () => {
  function buildPlan(many: boolean) {
    return SelectAst.from(TableSource.named('t')).withProjection([
      ProjectionItem.of('vals', ColumnRef.of('t', 'vals'), {
        codecId: 'test/upper@1',
        ...(many ? { many: true } : {}),
      }),
    ]);
  }

  it('maps the element codec over each element of the driver-parsed array', async () => {
    const calls: unknown[] = [];
    const codec = defineTestCodec({
      typeId: 'test/upper@1',
      encode: (v: string) => v,
      decode: (w: string) => {
        calls.push(w);
        return `DEC:${w}`;
      },
    });
    const registry = buildTestContractCodecs([codec]);
    const ast = buildPlan(true);
    const ctx = buildDecodeContext(ast, registry);

    const result = await decodeRow({ vals: ['a', 'b', 'c'] }, ctx, CTX, sqlNativeArrayListDecoder);

    expect(result['vals']).toEqual(['DEC:a', 'DEC:b', 'DEC:c']);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('passes null elements through without invoking the element codec', async () => {
    const calls: unknown[] = [];
    const codec = defineTestCodec({
      typeId: 'test/upper@1',
      encode: (v: string) => v,
      decode: (w: string) => {
        calls.push(w);
        return `DEC:${w}`;
      },
    });
    const registry = buildTestContractCodecs([codec]);
    const ast = buildPlan(true);
    const ctx = buildDecodeContext(ast, registry);

    const result = await decodeRow({ vals: ['x', null, 'z'] }, ctx, CTX, sqlNativeArrayListDecoder);

    expect(result['vals']).toEqual(['DEC:x', null, 'DEC:z']);
    expect(calls).toEqual(['x', 'z']);
  });

  it('wraps an element-level decode failure in RUNTIME.DECODE_FAILED', async () => {
    const identity = (v: unknown) => v as never;
    const codec = defineTestCodec({
      typeId: 'test/throw@1',
      encode: (v: unknown) => v,
      decode: (_w: unknown) => {
        throw new Error('element decode error');
      },
      encodeJson: identity,
      decodeJson: identity,
    });
    const registry = buildTestContractCodecs([codec]);
    const ast = SelectAst.from(TableSource.named('t')).withProjection([
      ProjectionItem.of('vals', ColumnRef.of('t', 'vals'), {
        codecId: 'test/throw@1',
        many: true,
      }),
    ]);
    const ctx = buildDecodeContext(ast, registry);

    await expect(
      decodeRow({ vals: [1, 2, 3] }, ctx, CTX, sqlNativeArrayListDecoder),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
    });
  });

  it('returns null for the whole column when the wire value is null (not an array)', async () => {
    const identity = (v: unknown) => v as never;
    const codec = defineTestCodec({
      typeId: 'test/upper@1',
      encode: (v: unknown) => v,
      decode: (w: unknown) => w,
      encodeJson: identity,
      decodeJson: identity,
    });
    const registry = buildTestContractCodecs([codec]);
    const ast = buildPlan(true);
    const ctx = buildDecodeContext(ast, registry);

    const result = await decodeRow({ vals: null }, ctx, CTX, sqlNativeArrayListDecoder);

    expect(result['vals']).toBeNull();
  });

  it('uses the explicit SQL default list decoder for driver-parsed arrays', async () => {
    const calls: unknown[] = [];
    const codec = defineTestCodec({
      typeId: 'test/upper@1',
      encode: (v: string) => v,
      decode: (w: string) => {
        calls.push(w);
        return `DEC:${w}`;
      },
    });
    const registry = buildTestContractCodecs([codec]);
    const ctx = buildDecodeContext(buildPlan(true), registry);

    const result = await decodeRow({ vals: ['a', 'b'] }, ctx, CTX, sqlNativeArrayListDecoder);

    expect(result).toEqual({ vals: ['DEC:a', 'DEC:b'] });
    expect(calls).toEqual(['a', 'b']);
  });

  it('scalar path (no many flag) applies codec to the whole wire value', async () => {
    const codec = defineTestCodec({
      typeId: 'test/upper@1',
      encode: (v: string) => v,
      decode: (w: string) => `DEC:${w}`,
    });
    const registry = buildTestContractCodecs([codec]);
    const ast = buildPlan(false);
    const ctx = buildDecodeContext(ast, registry);

    const result = await decodeRow({ vals: 'hello' }, ctx, CTX, sqlNativeArrayListDecoder);

    expect(result['vals']).toBe('DEC:hello');
  });
});

// ---------------------------------------------------------------------------
// ParamRef.of — many flag is preserved on the AST node
// ---------------------------------------------------------------------------

describe('ParamRef — many flag round-trips through frozenCodecRef', () => {
  it('preserves many:true on the codec slot of a ParamRef', () => {
    const ref = ParamRef.of('value', { codec: { codecId: 'test/x@1', many: true } });
    expect(ref.codec?.many).toBe(true);
    expect(ref.codec?.codecId).toBe('test/x@1');
  });

  it('preserves many:true alongside typeParams', () => {
    const ref = ParamRef.of('value', {
      codec: { codecId: 'test/x@1', typeParams: { precision: 10 }, many: true },
    });
    expect(ref.codec?.many).toBe(true);
    expect(ref.codec?.typeParams).toEqual({ precision: 10 });
  });

  it('does not add many to a scalar ParamRef', () => {
    const ref = ParamRef.of('value', { codec: { codecId: 'test/x@1' } });
    expect(ref.codec?.many).toBeUndefined();
  });
});

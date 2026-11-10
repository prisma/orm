import type {
  Codec,
  ContractCodecRegistry,
  SqlCodecCallContext,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { encodeParam } from '../src/codecs/encoding';
import { defineTestCodec } from './test-codec';

describe('encodeParam — CodecRef dispatch', () => {
  it('resolves via forCodecRef when paramRef.codec is populated', async () => {
    const codec1024 = defineTestCodec({
      typeId: 'pgvector/vector@1',
      toWire: (v: number[]) => `enc1024:${v.join(',')}`,
      fromWire: (wire: string) => wire.split(',').map(Number),
    });
    const codec1536 = defineTestCodec({
      typeId: 'pgvector/vector@1',
      toWire: (v: number[]) => `enc1536:${v.join(',')}`,
      fromWire: (wire: string) => wire.split(',').map(Number),
    });

    const calls: Array<['forCodecRef', string, unknown]> = [];
    const contractCodecs: ContractCodecRegistry = {
      forColumn: () => undefined,
      forCodecRef: (ref) => {
        calls.push(['forCodecRef', ref.codecId, ref.typeParams]);
        if (ref.typeParams === 1024) return codec1024;
        return codec1536;
      },
    };

    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const wireDoc = await encodeParam(
      [0.1, 0.2, 0.3],
      {
        codec: { codecId: 'pgvector/vector@1', typeParams: 1024 },
        name: 'p0',
      },
      0,
      ctx,
      contractCodecs,
    );

    expect(wireDoc).toBe('enc1024:0.1,0.2,0.3');

    const wirePage = await encodeParam(
      [0.4, 0.5],
      {
        codec: { codecId: 'pgvector/vector@1', typeParams: 1536 },
        name: 'p0',
      },
      0,
      ctx,
      contractCodecs,
    );

    expect(wirePage).toBe('enc1536:0.4,0.5');
    expect(calls).toEqual([
      ['forCodecRef', 'pgvector/vector@1', 1024],
      ['forCodecRef', 'pgvector/vector@1', 1536],
    ]);
  });

  it('resolves via forCodecRef when codec has no typeParams', async () => {
    const scalarCodec = defineTestCodec({
      typeId: 'test/scalar@1',
      toWire: (v: string) => `enc:${v}`,
      fromWire: (wire: string) => wire,
    });

    const calls: Array<['forCodecRef', string]> = [];
    const contractCodecs: ContractCodecRegistry = {
      forColumn: () => undefined,
      forCodecRef: (ref) => {
        calls.push(['forCodecRef', ref.codecId]);
        return scalarCodec;
      },
    };

    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const wire = await encodeParam(
      'hello',
      { codec: { codecId: 'test/scalar@1' }, name: 'p0' },
      0,
      ctx,
      contractCodecs,
    );

    expect(wire).toBe('enc:hello');
    expect(calls).toEqual([['forCodecRef', 'test/scalar@1']]);
  });

  it('returns passthrough when no codec is set on paramRef', async () => {
    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const wire = await encodeParam('raw', {}, 0, ctx);

    expect(wire).toBe('raw');
  });

  it('undefined values bypass codec dispatch and normalize to null', async () => {
    let invoked = false;
    const codec: Codec = defineTestCodec({
      typeId: 'pgvector/vector@1',
      toWire: (v: number[]) => {
        invoked = true;
        return v;
      },
      fromWire: (w: number[]) => w,
    });

    const contractCodecs: ContractCodecRegistry = {
      forColumn: () => undefined,
      forCodecRef: () => codec,
    };

    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const result = await encodeParam(
      undefined,
      {
        codec: { codecId: 'pgvector/vector@1', typeParams: 1024 },
        name: 'p0',
      },
      0,
      ctx,
      contractCodecs,
    );

    expect(result).toBeNull();
    expect(invoked).toBe(false);
  });

  it('null values bypass codec dispatch entirely', async () => {
    let invoked = false;
    const codec: Codec = defineTestCodec({
      typeId: 'pgvector/vector@1',
      toWire: (v: number[]) => {
        invoked = true;
        return v;
      },
      fromWire: (w: number[]) => w,
    });

    const contractCodecs: ContractCodecRegistry = {
      forColumn: () => undefined,
      forCodecRef: () => codec,
    };

    const ctx: SqlCodecCallContext = { signal: new AbortController().signal };

    const result = await encodeParam(
      null,
      {
        codec: { codecId: 'pgvector/vector@1', typeParams: 1024 },
        name: 'p0',
      },
      0,
      ctx,
      contractCodecs,
    );

    expect(result).toBeNull();
    expect(invoked).toBe(false);
  });
});

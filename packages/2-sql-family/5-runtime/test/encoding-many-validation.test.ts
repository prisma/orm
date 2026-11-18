import type {
  Codec,
  ContractCodecRegistry,
  SqlCodecCallContext,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { encodeParamsWithMetadata, type ParamMetadata } from '../src/codecs/encoding';

function makeCtx(): SqlCodecCallContext {
  return { signal: undefined } as unknown as SqlCodecCallContext;
}

describe('encodeParamsWithMetadata — many-typed parameter validation', () => {
  it('throws RUNTIME.ENCODE_FAILED when a many-typed param value is not an array', async () => {
    const fakeCodec = {
      id: 'test/int@1',
      encode: async (v: unknown) => v,
      decode: async (v: unknown) => v,
    } as unknown as Codec;
    const contractCodecs = {
      forCodecRef: () => fakeCodec,
    } as unknown as ContractCodecRegistry;
    const metadata = [
      { codec: { codecId: 'test/int@1', many: true }, name: 'ids' },
    ] as unknown as ParamMetadata[];

    await expect(
      encodeParamsWithMetadata([123], metadata, makeCtx(), contractCodecs),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: expect.stringContaining('expected an array for many-typed parameter'),
    });
  });

  it('wraps a non-Error thrown by codec.encode using String(error)', async () => {
    const throwingCodec = {
      id: 'test/broken@1',
      encode: async () => {
        throw 'plain string failure';
      },
      decode: async (v: unknown) => v,
    } as unknown as Codec;
    const contractCodecs = {
      forCodecRef: () => throwingCodec,
    } as unknown as ContractCodecRegistry;
    const metadata = [
      { codec: { codecId: 'test/broken@1' }, name: 'value' },
    ] as unknown as ParamMetadata[];

    await expect(
      encodeParamsWithMetadata(['x'], metadata, makeCtx(), contractCodecs),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: expect.stringContaining('plain string failure'),
    });
  });
});

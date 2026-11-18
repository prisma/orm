import { describe, expect, it } from 'vitest';
import { encodeParamsWithMetadata } from '../src/codecs/encoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

describe('encodeParamsWithMetadata — many-typed parameter validation', () => {
  it('throws RUNTIME.ENCODE_FAILED when a many-typed param value is not an array', async () => {
    const contractCodecs = buildTestContractCodecs([
      defineTestCodec({
        typeId: 'test/int@1',
        toWire: (v: number) => v,
        fromWire: (w: number) => w,
      }),
    ]);
    const metadata = [{ codec: { codecId: 'test/int@1', many: true }, name: 'ids' }];

    await expect(
      encodeParamsWithMetadata([123], metadata, {}, contractCodecs),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: expect.stringContaining('expected an array for many-typed parameter'),
    });
  });

  it('wraps a non-Error thrown by codec.toWire using String(error)', async () => {
    const contractCodecs = buildTestContractCodecs([
      defineTestCodec({
        typeId: 'test/broken@1',
        toWire: (_v: string): string => {
          throw 'plain string failure';
        },
        fromWire: (w: string) => w,
      }),
    ]);
    const metadata = [{ codec: { codecId: 'test/broken@1' }, name: 'value' }];

    await expect(
      encodeParamsWithMetadata(['x'], metadata, {}, contractCodecs),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: expect.stringContaining('plain string failure'),
    });
  });
});

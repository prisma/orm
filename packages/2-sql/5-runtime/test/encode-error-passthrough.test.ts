import { runtimeError } from '@internal/framework-components/runtime';
import type { SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { encodeParam } from '../src/codecs/encoding';
import { defineTestCodec } from './test-codec';
import { buildTestContractCodecs } from './utils';

const ctx: SqlCodecCallContext = {};

function throwingRegistry(original: unknown) {
  return buildTestContractCodecs([
    defineTestCodec({
      typeId: 'test/passthrough@1',
      targetTypes: ['text'],
      encode: () => {
        throw original;
      },
      decode: (wire: string) => wire,
    }),
  ]);
}

describe('encodeParam — structured-envelope passthrough', () => {
  it('rethrows codec-authored runtimeError RUNTIME.ENCODE_FAILED without wrapping', async () => {
    const original = runtimeError('RUNTIME.ENCODE_FAILED', 'codec-authored failure', {
      codec: 'test/passthrough@1',
    });

    await expect(
      encodeParam(
        'value',
        { codec: { codecId: 'test/passthrough@1' }, name: 'p0' },
        0,
        ctx,
        throwingRegistry(original),
      ),
    ).rejects.toBe(original);
  });

  it('rethrows a plain structuredError ENCODE_FAILED envelope without wrapping', async () => {
    const original = structuredError('RUNTIME.ENCODE_FAILED', 'extension codec failure', {
      meta: { codec: 'test/passthrough@1' },
    });

    await expect(
      encodeParam(
        'value',
        { codec: { codecId: 'test/passthrough@1' }, name: 'p0' },
        0,
        ctx,
        throwingRegistry(original),
      ),
    ).rejects.toBe(original);
  });

  it('rethrows a plain structuredError envelope from a many-element encode without wrapping', async () => {
    const original = structuredError('RUNTIME.ENCODE_FAILED', 'element encode failure');

    await expect(
      encodeParam(
        ['value'],
        { codec: { codecId: 'test/passthrough@1', many: true }, name: 'p0' },
        0,
        ctx,
        throwingRegistry(original),
      ),
    ).rejects.toBe(original);
  });

  describe('rethrows an InternalError from a codec unchanged', () => {
    const original = new InternalError('codec invariant broke');

    it('for one value', async () => {
      await expect(
        encodeParam(
          'value',
          { codec: { codecId: 'test/passthrough@1' }, name: 'p0' },
          0,
          ctx,
          throwingRegistry(original),
        ),
      ).rejects.toBe(original);
    });

    it('for an element of a many-typed parameter', async () => {
      await expect(
        encodeParam(
          ['value'],
          { codec: { codecId: 'test/passthrough@1', many: true }, name: 'p0' },
          0,
          ctx,
          throwingRegistry(original),
        ),
      ).rejects.toBe(original);
    });
  });

  it('wraps a foreign Error into RUNTIME.ENCODE_FAILED with the original on cause', async () => {
    const original = new Error('boom');

    await expect(
      encodeParam(
        'value',
        { codec: { codecId: 'test/passthrough@1' }, name: 'p0' },
        0,
        ctx,
        throwingRegistry(original),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      cause: original,
      details: {
        label: 'p0',
        codec: 'test/passthrough@1',
        paramIndex: 0,
      },
    });
  });
});

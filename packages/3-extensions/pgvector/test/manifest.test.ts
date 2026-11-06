import { describe, expect, it } from 'vitest';
import { VECTOR_CODEC_ID } from '../src/core/constants';
import { pgvectorExtensionDescriptor } from '../src/exports/control';
import pgvectorRuntimeDescriptor from '../src/exports/runtime';

describe('pgvector descriptor', () => {
  it('has codec types import', () => {
    expect(pgvectorExtensionDescriptor.types?.codecTypes?.import).toEqual({
      package: '@internal/extension-pgvector/codec-types',
      named: 'CodecTypes',
      alias: 'PgVectorTypes',
    });
  });

  it('parameterized vector descriptor does not expose encode fallback opt-out metadata', () => {
    const vectorDescriptor = pgvectorRuntimeDescriptor
      .codecs()
      .find((descriptor) => descriptor.codecId === VECTOR_CODEC_ID);
    expect(vectorDescriptor).toBeDefined();
    expect(vectorDescriptor).not.toHaveProperty('encodeIsParamsIndependent');
  });
});

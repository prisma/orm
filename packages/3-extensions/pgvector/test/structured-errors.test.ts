import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { PgVectorCodec, pgVectorDescriptor } from '../src/core/codecs';
import { VECTOR_MAX_DIM } from '../src/core/constants';
import { vector } from '../src/exports/column-types';

const codecCtx = {};

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected fn to throw');
}

async function catchAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected fn to reject');
}

describe('pgvector structured error codes', () => {
  it('RUNTIME.ENCODE_FAILED on encode with a length mismatch', async () => {
    const codec = new PgVectorCodec(pgVectorDescriptor, 3);
    const err = await catchAsyncError(() => codec.encode([1, 2], codecCtx));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'Vector length mismatch: expected 3, got 2',
      meta: { codecId: 'pg/vector@1', expectedLength: 3, receivedLength: 2 },
    });
  });

  it('RUNTIME.ENCODE_FAILED on encodeJson with a non-array value', () => {
    const codec = new PgVectorCodec(pgVectorDescriptor, 3);
    const err = catchError(() => codec.encodeJson('nope' as unknown as number[]));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'Vector value must be an array of numbers',
    });
  });

  it('RUNTIME.DECODE_FAILED on decode of a malformed wire string', () => {
    const codec = new PgVectorCodec(pgVectorDescriptor, 3);
    const err = catchError(() => codec.decode('not a vector', codecCtx));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'Invalid vector format: expected "[...]", got "not a vector"',
      meta: { codecId: 'pg/vector@1', wirePreview: 'not a vector' },
    });
  });

  it('RUNTIME.DECODE_FAILED (not ENCODE_FAILED) on decode with a length mismatch', () => {
    const codec = new PgVectorCodec(pgVectorDescriptor, 3);
    const err = catchError(() => codec.decode('[1,2]', codecCtx));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'Vector length mismatch: expected 3, got 2',
    });
  });

  it('RUNTIME.DECODE_FAILED on decodeJson of a non-array value', () => {
    const codec = new PgVectorCodec(pgVectorDescriptor, 3);
    const err = catchError(() => codec.decodeJson(123));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: 'Vector database JSON value must be an array',
    });
  });

  it('CONTRACT.ARGUMENT_INVALID on vector() with an out-of-range dimension', () => {
    const err = catchError(() => vector(0 as number));
    expect(isStructuredError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: `pgvector: dimension must be an integer in [1, ${VECTOR_MAX_DIM}], got 0`,
      meta: { helperPath: 'vector', received: 0 },
    });
  });
});

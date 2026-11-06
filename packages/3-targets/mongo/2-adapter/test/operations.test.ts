import { MONGO_VECTOR_CODEC_ID } from '@internal/target-mongo/codec-ids';
import { describe, expect, it } from 'vitest';
import { mongoVectorNearOperation, mongoVectorOperationDescriptors } from '../src/core/operations';

describe('vector operation descriptors (production-defined)', () => {
  it('mongoVectorNearOperation targets the vector codec', () => {
    expect(mongoVectorNearOperation.self?.codecId).toBe(MONGO_VECTOR_CODEC_ID);
  });

  it('mongoVectorOperationDescriptors includes near', () => {
    expect(Object.keys(mongoVectorOperationDescriptors)).toEqual(['near']);
    expect(mongoVectorOperationDescriptors['near']).toBe(mongoVectorNearOperation);
  });
});
